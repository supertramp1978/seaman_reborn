import { overrideModelName, OLLAMA_URL, MODEL_NAME } from "../config/env.js";
import { chatStore } from "./chat/store.js";
import { initChatRenderer } from "./ui/chat-renderer.js";
import { loadModel as loadSTT } from "./audio/stt.js";
import { initAudioBus, startVoiceMode, stopVoiceMode } from "./audio/audio-bus.js";
import { resumeAudioContext } from "./audio/tts.js";
import { loadEmbedder } from "./memory/embedder.js";
import { wipeDB } from "./memory/db.js";
import { initMemoryBus } from "./memory/memory-bus.js";
import { initAquarium, startRenderLoop, getScene } from "./scene/aquarium.js";
import { loadModel as loadSceneModel, getModel, getInnerModel, getMouthMorph } from "./scene/seaman-model.js";
import { initSwimming, updateSwimming, triggerWaterChangeReaction } from "./scene/swimming.js";
import { initBubbles, updateBubbles } from "./scene/particles.js";
import { initLipSync, updateLipSync } from "./scene/lip-sync.js";
import { initInteraction } from "./scene/interaction.js";
import { showTitleScreen } from "./scene/title-screen.js";
import { showIntroScreen } from "./scene/intro-screen.js";
import { showResumeScreen } from "./scene/resume-screen.js";
import { initStatus, onConversation, startWaterChange, stopWaterChange, onFed, getStatusSnapshot, statusEvents } from "./state/seaman-status.js";
import { initStaticVoice, triggerVoiceEvent, checkKeywordAndTrigger } from "./audio/static-voice.js";
import { initStatusPanel, renderStatus } from "./ui/status-panel.js";
import { se } from "./audio/se.js";
import { initFood, spawnFood, updateFood } from "./scene/food.js";

window.chatStore = chatStore;

async function main() {
  const params = new URLSearchParams(location.search);

  const modelOverride = params.get("model");
  if (modelOverride) overrideModelName(modelOverride);

  const voiceDefault = params.get("voice") === "on";

  // DOM 参照
  const logEl         = document.querySelector("#chat-log");
  const thinkingEl    = document.querySelector("#thinking");
  const formEl        = document.querySelector("#input-form");
  const inputEl       = document.querySelector("#input");
  const sendBtn       = document.querySelector("#send");
  const micBtn        = document.querySelector("#mic-toggle");
  const voiceStateEl  = document.querySelector("#voice-state");
  const preloadStatus = document.querySelector("#preload-status");
  const sceneCanvas   = document.querySelector("#scene-canvas");

  if (!logEl || !formEl || !inputEl || !sendBtn) {
    console.error("[main] required DOM elements not found");
    return;
  }

  initChatRenderer({ logEl, thinkingEl, voiceStateEl });

  // ── テキスト UI（Phase 1 のまま）──────────────────────────────────────────
  const setUiBusy = (busy) => {
    inputEl.disabled = busy;
    sendBtn.disabled = busy;
    if (!busy) inputEl.focus();
  };
  chatStore.on("userMessage",   () => setUiBusy(true));
  chatStore.on("assistantDone", () => setUiBusy(false));
  chatStore.on("error",         () => setUiBusy(false));

  // ユーザーインタラクション時に AudioContext を resume（オートプレイポリシー対策）
  const resumeOnce = () => { resumeAudioContext(); };
  formEl.addEventListener("submit",  resumeOnce, { once: true });
  inputEl.addEventListener("keydown", resumeOnce, { once: true });

  // 会話履歴トグル
  const chatToggleBtn    = document.querySelector('#chat-toggle-btn');
  const chatLogWrapper   = document.querySelector('#chat-log-wrapper');
  if (chatToggleBtn && chatLogWrapper) {
    chatToggleBtn.addEventListener('click', () => {
      const open = chatLogWrapper.classList.toggle('open');
      chatToggleBtn.textContent = open ? '会話履歴 ▲' : '会話履歴 ▼';
    });
  }

  formEl.addEventListener("submit", (ev) => { ev.preventDefault(); submitText(); });
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault(); submitText();
    }
  });

  function submitText() {
    if (chatStore.isStreaming()) return;
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    chatStore.sendMessage(text);
  }
  inputEl.focus();

  // ── 3D シーン（WebGL 非対応なら無視してテキストモードで継続）────────────────
  let sceneReady = false;
  let _camera3d = null;

  if (sceneCanvas) {
    try {
      const { camera } = initAquarium(sceneCanvas);
      _camera3d = camera;
      initSwimming();
      initBubbles(getScene());
      sceneReady = true;

      // レンダーループをモデルロード前から起動（水槽が先に見える）
      let lastTime = 0;
      startRenderLoop((now) => {
        const dt = lastTime > 0 ? (now - lastTime) / 1000 : 0;
        lastTime = now;
        updateSwimming(getModel(), now / 1000, chatStore.getVoiceState());
        updateBubbles(dt, now / 1000);
        updateLipSync(getMouthMorph(), dt);
        updateFood(dt);
      });
    } catch (e3d) {
      console.error("[main] WebGL init failed:", e3d.message);
      chatStore.emit("error", {
        id: null,
        error: Object.assign(new Error(e3d.message), { kind: "webgl" }),
      });
    }
  }

  // ?reset=memory → IndexedDB を全削除して起動（debug 用）
  if (params.get("reset") === "memory") {
    await wipeDB().catch(e => console.warn("[main] wipeDB failed:", e.message));
    console.debug("[main] memory wiped");
  }

  // ?voice=skip → テキストのみで直接起動
  if (params.get("voice") === "skip") {
    if (sceneReady) {
      await loadSceneModel(getScene(), {});
      initInteraction(sceneCanvas, _camera3d, getInnerModel());
      initLipSync();
    }
    return;
  }

  let voiceReady = false;
  const skipMemory = params.get("memory") === "skip";

  // タイトル画面を即座に表示（プリロードはまだ開始しない）
  await showTitleScreen();

  // イントロ画面を表示しながら、プリロードと Ollama ウォームアップを並行開始
  const introPromise = showIntroScreen();

  _warmupOllama();

  const setStatus = (msg) => { if (preloadStatus) preloadStatus.textContent = msg; };

  const preloadPromise = (async () => {
    try {
      // 1. VAD 初期化
      setStatus("VAD を初期化中…");
      await initAudioBus();

      // 2. Whisper モデルのロード
      setStatus("Whisper モデルをロード中…");
      await loadSTT({
        onProgress: (n) => setStatus(`Whisper: ${(n * 100).toFixed(0)}%`),
      });

      // 3. 3D モデルのロード
      if (sceneReady) {
        setStatus("シーマンの体を読み込み中…");
        await loadSceneModel(getScene(), {
          onProgress: (n) => setStatus(`3Dモデル: ${(n * 100).toFixed(0)}%`),
        });
        initInteraction(sceneCanvas, _camera3d, getInnerModel());
        initLipSync();
      }

      // 4. Embedder（Transformers.js + multilingual-e5-small）
      if (!skipMemory) {
        setStatus("シーマンの記憶を読み込み中…");
        await loadEmbedder({
          onProgress: (n) => setStatus(`記憶モデル: ${(n * 100).toFixed(0)}%`),
        });
        await initMemoryBus();
      }

      if (micBtn) micBtn.disabled = false;
      voiceReady = true;
      setStatus("");
      console.debug("[main] voice ready  crossOriginIsolated:", self.crossOriginIsolated);

    } catch (e) {
      console.warn("[main] プリロード失敗:", e.message);
      setStatus("音声機能を利用できません");
      chatStore.emit("error", { id: null, error: Object.assign(new Error(e.message), { kind: "memory_unavailable" }) });

      if (sceneReady && !getModel()) {
        try {
          await loadSceneModel(getScene(), {});
          initInteraction(sceneCanvas, _camera3d, getInnerModel());
          initLipSync();
        } catch { /* ignore */ }
      }
    }
  })();

  // ユーザーが説明を読み終えるまで待ち、その後プリロード完了も待つ
  await introPromise;
  await preloadPromise;

  // ── ステータス管理 ────────────────────────────────────────────────────────
  const isFirstVisit = !localStorage.getItem('seaman_visited');
  localStorage.setItem('seaman_visited', '1');

  // オフライン経過分を計算・保存（再開画面で最新値を表示するために先に実行）
  initStatus({ onWaterChangeEffect: triggerWaterChangeReaction });

  // 2回目以降はゲーム再開画面を挟む
  if (!isFirstVisit) {
    await showResumeScreen();
  }

  // タイトル・イントロ画面が終わったので水槽画面を表示
  document.querySelector('.app').style.opacity = '1';
  if (sceneReady) initFood(getScene());

  await se.loadBuffer('water_change', 'assets/audio/se_water_change.mp3');
  await se.loadBuffer('feed',         'assets/audio/se_feed.mp3');

  initStatusPanel({
    onWaterChangeStart: () => {
      startWaterChange(() => renderStatus(getStatusSnapshot()));
      se.startAmbient('water_change', { volume: 0.7 });
    },
    onWaterChangeStop: () => {
      stopWaterChange();
      se.stopAmbient('water_change');
      renderStatus(getStatusSnapshot());
    },
    onFed: () => {
      onFed();
      se.playOneShot('feed', { volume: 0.8 });
      spawnFood();
      renderStatus(getStatusSnapshot());
    },
  });

  renderStatus(getStatusSnapshot());

  chatStore.on('assistantDone', () => {
    onConversation();
    renderStatus(getStatusSnapshot());
  });

  setInterval(() => renderStatus(getStatusSnapshot()), 60_000);

  // ── 静的会話 ──────────────────────────────────────────────────────────────
  await initStaticVoice();

  // statusEvents → 音声イベント配線
  statusEvents.on('water_temp_high',            () => triggerVoiceEvent('water_temp_high'));
  statusEvents.on('water_temp_low',             () => triggerVoiceEvent('water_temp_low'));
  statusEvents.on('water_quality_bad',          () => triggerVoiceEvent('water_quality_bad'));
  statusEvents.on('water_quality_good',         () => triggerVoiceEvent('water_quality_good'));
  statusEvents.on('mood_up',                    () => triggerVoiceEvent('mood_up'));
  statusEvents.on('mood_down',                  () => triggerVoiceEvent('mood_down'));
  statusEvents.on('trust_up',                   () => triggerVoiceEvent('trust_up'));
  statusEvents.on('trust_down',                 () => triggerVoiceEvent('trust_down'));
  statusEvents.on('stage_larva_to_juvenile',    () => triggerVoiceEvent('stage_larva_to_juvenile'));
  statusEvents.on('stage_juvenile_to_adult',    () => triggerVoiceEvent('stage_juvenile_to_adult'));
  statusEvents.on('stage_adult_to_new_species', () => triggerVoiceEvent('stage_adult_to_new_species'));

  // キーワード検出
  chatStore.on('userMessage', ({ content }) => checkKeywordAndTrigger(content));

  // ゲーム開始/再開（force:true でクールダウン無視）
  triggerVoiceEvent(isFirstVisit ? 'game_start' : 'game_resume', { force: true });

  // ── マイクボタン ─────────────────────────────────────────────────────────
  if (micBtn) {
    micBtn.addEventListener("click", async () => {
      if (!voiceReady) return;
      const isOn = micBtn.classList.toggle("active");
      if (isOn) {
        try {
          await startVoiceMode();
        } catch (e) {
          micBtn.classList.remove("active");
          const kind = e.name === "NotAllowedError" ? "mic_denied"
                     : e.name === "NotFoundError"   ? "mic_missing"
                     : "unknown";
          chatStore.emit("error", { id: null, error: Object.assign(new Error(e.message), { kind }) });
        }
      } else {
        stopVoiceMode();
      }
    });
  }

  if (voiceDefault && voiceReady && micBtn) {
    micBtn.classList.add("active");
    startVoiceMode();
  }
}

// Ollama に最小リクエストを投げてモデルを VRAM に展開しておく（遅延隠蔽）
function _warmupOllama() {
  fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      options: { num_predict: 1 },
    }),
  }).catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main, { once: true });
} else {
  main();
}
