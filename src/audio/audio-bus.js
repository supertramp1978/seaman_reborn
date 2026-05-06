// audio-bus: VAD → STT → ChatStore のオーケストレーション。
// 状態遷移: idle → listening → transcribing → thinking → speaking → listening
// TTS 終了後 VAD_RESUME_MS だけ待ってから listening に戻す（残響・フィードバック防止）。

import { chatStore } from "../chat/store.js";
import { loadVadLib, initVad, getMicVad, startVad, stopVad, pauseVad, resumeVad } from "./vad.js";
import { transcribe, isModelLoaded } from "./stt.js";
import { ttsQueue } from "./tts.js";

const VAD_RESUME_MS = 300; // TTS 終了後 VAD を再開するまでの待機時間 (todo02.md 6-2 参照)

let voiceModeOn    = false;
let initialized    = false;
let isTranscribing = false; // 並列 STT 防止フラグ

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// 初期化
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VAD・TTS を初期化し audio-bus のイベント配線を行う。
 * stt.js (loadModel) は呼び出し元 (main.js) 側でプリロードとして処理する。
 */
export async function initAudioBus({ onModelProgress } = {}) {
  if (initialized) return;

  // VAD ライブラリのみロード（マイク許可はボタン押下まで遅延）
  await loadVadLib();

  // TTS → ChatStore 連携
  // pauseVad() を enqueue より先に呼ぶ: speak() 呼び出し前に VAD を止め
  // 「pauseVad → onstart 間に VAD が音声検出してしまう」レースを解消する
  chatStore.on("assistantSentence", ({ sentence }) => {
    if (voiceModeOn) pauseVad();
    ttsQueue.enqueue(sentence);
  });

  // TTS 再生開始 → 状態遷移（VAD は assistantSentence で既に pause 済み）
  ttsQueue.on("start", () => {
    chatStore.setVoiceState("speaking");
  });

  // TTS キュー空になった → VAD_RESUME_MS 後に listening へ戻す
  ttsQueue.on("end", async () => {
    if (!voiceModeOn) return;
    chatStore.setVoiceState("idle");
    await sleep(VAD_RESUME_MS);
    if (voiceModeOn) {
      resumeVad();
      chatStore.setVoiceState("listening");
    }
  });

  // Ollama 初回トークン受信 → thinking → speaking の遷移は
  // assistantSentence イベント + TTS start で自動処理されるが、
  // "thinking" 状態を明示するため sending〜first-sentence 間に設定する。
  chatStore.on("userMessage", () => {
    if (voiceModeOn) chatStore.setVoiceState("thinking");
  });
  chatStore.on("assistantDone", () => {
    // TTS キューが空の場合（文が来なかった場合）はここで listening へ戻す
    if (voiceModeOn && ttsQueue.isEmpty()) {
      chatStore.setVoiceState("listening");
    }
  });
  chatStore.on("error", () => {
    if (voiceModeOn) {
      ttsQueue.clear();
      chatStore.setVoiceState("listening");
    }
  });

  initialized = true;
  console.debug("[audio-bus] initialized");
}

// ─────────────────────────────────────────────────────────────────────────────
// ボイスモード ON/OFF
// ─────────────────────────────────────────────────────────────────────────────

export async function startVoiceMode() {
  if (voiceModeOn) return;
  // micVad が未初期化（初回 or stop 後）のときここでマイク許可を要求する
  // NotAllowedError / NotFoundError は呼び出し元（main.js）で catch してエラーバブル表示
  if (!getMicVad()) {
    await initVad({
      onSpeechStart: handleSpeechStart,
      onSpeechEnd:   handleSpeechEnd,
    });
  }
  voiceModeOn = true;
  startVad();
  chatStore.setVoiceState("listening");
  console.debug("[audio-bus] voice mode ON");
}

export function stopVoiceMode() {
  voiceModeOn = false;
  stopVad();
  ttsQueue.clear();
  chatStore.abort();
  chatStore.setVoiceState("idle");
  console.debug("[audio-bus] voice mode OFF");
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部ハンドラ
// ─────────────────────────────────────────────────────────────────────────────

function handleSpeechStart() {
  chatStore.setVoiceState("listening"); // VAD が音を拾っている間は listening のまま
}

async function handleSpeechEnd(audioBuffer) {
  if (!voiceModeOn) return;

  // STT がロードされていない場合は無視（プリロード未完了）
  if (!isModelLoaded()) {
    console.warn("[audio-bus] STT モデル未ロード、転写をスキップ");
    return;
  }

  // 並列 STT 防止: _captureHandler の上書きによる転写失敗を防ぐ
  if (isTranscribing) {
    console.debug("[audio-bus] STT 実行中のため音声をスキップ");
    return;
  }

  // TTS/Ollama 処理中は VAD ループ抑止のソフトウェアゲート
  const state = chatStore.getVoiceState();
  if (state === "speaking" || state === "thinking") {
    console.debug("[audio-bus] TTS/Ollama 処理中の音声をスキップ:", state);
    return;
  }

  const t0 = performance.now(); // speechEnd 基点
  isTranscribing = true;
  chatStore.setVoiceState("transcribing");

  let text = "";
  try {
    text = await transcribe(audioBuffer);
  } catch (e) {
    console.warn("[audio-bus] STT エラー:", e);
    chatStore.emit("error", {
      id: null,
      error: Object.assign(new Error(e.message), { kind: "stt" }),
    });
    if (voiceModeOn) chatStore.setVoiceState("listening");
    return;
  } finally {
    isTranscribing = false;
  }

  const t1 = performance.now(); // STT 完了

  // 空文字（無音・短すぎる発話）は無視して listening へ戻す
  if (!text) {
    console.debug("[audio-bus] STT 結果が空、スキップ");
    if (voiceModeOn) chatStore.setVoiceState("listening");
    return;
  }

  console.debug("[audio-bus] STT →", text);

  // [perf] 計測: Ollama 初トークン・TTS 開始のタイミングを one-shot リスナーで記録
  let t2 = null;
  const onFirstChunk = () => {
    t2 = performance.now();
    chatStore.off("assistantChunk", onFirstChunk);
  };
  chatStore.on("assistantChunk", onFirstChunk);

  const onTtsStart = () => {
    const t3 = performance.now();
    ttsQueue.off("start", onTtsStart);
    chatStore.off("assistantChunk", onFirstChunk); // 念のためクリーンアップ
    console.debug(
      `[perf] stt=${(t1 - t0).toFixed(0)}ms` +
      ` ollama_1st=${t2 != null ? (t2 - t1).toFixed(0) : "?"}ms` +
      ` tts_start=${(t3 - t1).toFixed(0)}ms` +
      ` total(speechEnd→TTS)=${(t3 - t0).toFixed(0)}ms`
    );
  };
  ttsQueue.on("start", onTtsStart);

  // sendMessage が userMessage イベントを emit → "thinking" 遷移は store.on で処理
  chatStore.sendMessage(text);
}
