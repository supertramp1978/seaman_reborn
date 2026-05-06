// TTS ラッパー: VOICEVOX を優先し、未起動時は SpeechSynthesis にフォールバック。
// 外部 API (enqueue / clear / pause / resume / isEmpty / on / off) は Phase 2 から不変。
// audio-bus.js と lip-sync.js は変更なし。

import { chatStore } from "../chat/store.js";
import { checkVoicevox, synthesizeText } from "./voicevox.js";
import { VOICEVOX_SPEAKER_ID } from "../../config/env.js";

class TtsQueue {
  #queue   = [];   // { text, wavPromise: Promise<ArrayBuffer>|null }
  #playing = false;
  #paused  = false;
  #listeners = new Map();

  // VOICEVOX パス
  #useVoicevox = false;
  #audioCtx    = null;
  #currentSrc  = null;
  #ready       = false; // バックエンド検出完了フラグ

  // SpeechSynthesis フォールバックパス
  #voice = null;

  constructor() {
    // SpeechSynthesis ボイス選択（フォールバック用）
    const pickVoice = () => {
      const voices = speechSynthesis.getVoices();
      this.#voice =
        voices.find(v => v.lang === "ja-JP" && v.localService) ??
        voices.find(v => v.lang === "ja-JP") ??
        voices[0] ?? null;
    };
    if (speechSynthesis.getVoices().length > 0) pickVoice();
    speechSynthesis.addEventListener("voiceschanged", pickVoice, { once: true });

    // VOICEVOX 起動確認（非同期。2 秒以内に完了）
    this.#detectBackend();
  }

  async #detectBackend() {
    try {
      const ok = await checkVoicevox();
      if (ok) {
        this.#audioCtx    = new AudioContext();
        this.#useVoicevox = true;
        console.debug(`[tts] VOICEVOX ready (speaker=${VOICEVOX_SPEAKER_ID})`);
      } else {
        console.debug("[tts] VOICEVOX unreachable → SpeechSynthesis fallback");
        chatStore.emit("error", {
          id: null,
          error: Object.assign(new Error("voicevox unreachable"), { kind: "voicevox_unavailable" }),
        });
      }
    } catch (e) {
      console.warn("[tts] backend detection failed:", e.message);
    } finally {
      this.#ready = true;
      // 検出完了前にキューに積まれた文があれば再生開始
      if (this.#queue.length > 0 && !this.#playing) this.#playNext();
    }
  }

  // ── 公開 API ──────────────────────────────────────────────────────────────

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
  }

  off(event, fn) {
    this.#listeners.get(event)?.delete(fn);
  }

  isEmpty() {
    return this.#queue.length === 0 && !this.#playing;
  }

  enqueue(sentence) {
    const text = sentence?.trim();
    if (!text) return;

    // VOICEVOX 確定済みならすぐに Prefetch（前の文を再生中に次の合成を先行）
    const wavPromise = (this.#useVoicevox && this.#ready)
      ? synthesizeText(text, VOICEVOX_SPEAKER_ID)
          .catch(e => { console.warn("[tts] prefetch failed:", e.message); return null; })
      : null;

    this.#queue.push({ text, wavPromise });
    if (this.#ready && !this.#playing) this.#playNext();
  }

  clear() {
    this.#queue  = [];
    this.#paused = false;
    if (this.#useVoicevox) {
      try { this.#currentSrc?.stop(); } catch {}
      this.#currentSrc = null;
    } else {
      speechSynthesis.cancel();
    }
    this.#playing = false;
  }

  pause() {
    this.#paused = true;
    if (this.#useVoicevox) this.#audioCtx?.suspend();
    else speechSynthesis.pause();
  }

  resume() {
    this.#paused = false;
    if (this.#useVoicevox) this.#audioCtx?.resume();
    else speechSynthesis.resume();
  }

  // AudioContext はブラウザのオートプレイポリシーで suspended になることがある。
  // main.js のユーザーインタラクション時にこれを呼ぶ。
  resumeAudio() {
    if (this.#audioCtx?.state === "suspended") this.#audioCtx.resume();
  }

  // ── 内部再生ループ ────────────────────────────────────────────────────────

  #emit(event, data) {
    const set = this.#listeners.get(event);
    if (set) for (const fn of set) { try { fn(data); } catch {} }
  }

  async #playNext() {
    if (this.#queue.length === 0) {
      this.#playing = false;
      this.#emit("end", {});
      chatStore.setVoiceState?.("idle");
      return;
    }
    const { text, wavPromise } = this.#queue.shift();
    this.#playing = true;

    if (this.#useVoicevox) {
      await this.#playVoicevox(text, wavPromise);
    } else {
      this.#playSpeechSynthesis(text);
    }
  }

  async #playVoicevox(text, existingPromise) {
    try {
      // Prefetch があればそれを使う。なければここで合成（検出前に enqueue された文）
      const arrayBuffer = await (existingPromise ?? synthesizeText(text, VOICEVOX_SPEAKER_ID));
      if (!arrayBuffer) { this.#playNext(); return; }

      if (this.#audioCtx.state === "suspended") await this.#audioCtx.resume();

      const audioBuffer = await this.#audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const source      = this.#audioCtx.createBufferSource();
      source.buffer     = audioBuffer;
      source.connect(this.#audioCtx.destination);
      this.#currentSrc  = source;

      this.#emit("start", { text });
      chatStore.setVoiceState?.("speaking");

      source.onended = () => { if (!this.#paused) this.#playNext(); };
      source.start();
    } catch (e) {
      console.warn("[tts] VOICEVOX playback error:", e.message);
      this.#playNext();
    }
  }

  #playSpeechSynthesis(text) {
    console.debug("[tts] SpeechSynthesis fallback: speaking →", text.slice(0, 20));
    const utt = new SpeechSynthesisUtterance(text);
    if (this.#voice) utt.voice = this.#voice;
    utt.lang = "ja-JP";
    utt.rate  = 1.05;

    utt.onstart = () => {
      console.debug("[tts] SpeechSynthesis onstart");
      this.#emit("start", { text });
      chatStore.setVoiceState?.("speaking");
    };
    utt.onboundary = (ev) => {
      this.#emit("boundary", { charIndex: ev.charIndex, charLength: ev.charLength, text });
    };
    utt.onend   = () => this.#playNext();
    utt.onerror = (ev) => {
      if (ev.error !== "interrupted") console.warn("[tts] SpeechSynthesis error:", ev.error);
      this.#playNext();
    };

    try { speechSynthesis.speak(utt); } catch (e) {
      console.warn("[tts] speak() failed:", e);
      this.#playNext();
    }
  }
}

export const ttsQueue = new TtsQueue();

// main.js でユーザーインタラクション時に呼び、AudioContext を確実に resume する
export function resumeAudioContext() {
  ttsQueue.resumeAudio();
}
