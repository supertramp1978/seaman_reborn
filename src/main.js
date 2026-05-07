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
import { initStatus, onConversation, onWaterChange, onFed, getStatusSnapshot } from "./state/seaman-status.js";
import { initStatusPanel, renderStatus } from "./ui/status-panel.js";

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

  // タイトル・イントロ画面が終わったので水槽画面を表示
  document.querySelector('.app').style.opacity = '1';

  // ── ステータス管理 ────────────────────────────────────────────────────────
  initStatus({ onWaterChangeEffect: triggerWaterChangeReaction });

  initStatusPanel({
    onWaterChange: () => { onWaterChange(); renderStatus(getStatusSnapshot()); },
    onFed:         () => { onFed();         renderStatus(getStatusSnapshot()); },
  });

  renderStatus(getStatusSnapshot());

  chatStore.on('assistantDone', () => {
    onConversation();
    renderStatus(getStatusSnapshot());
  });

  setInterval(() => renderStatus(getStatusSnapshot()), 60_000);

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
