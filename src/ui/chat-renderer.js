// chat-renderer: ChatStore のリスナーとして DOM を更新する唯一の場所。
// Phase 2 追加: voiceState インジケーター、転写中バブル仮表示、エラー拡張。

import { chatStore } from "../chat/store.js";
import { OllamaError } from "../chat/ollama.js";

const ERROR_LINES = {
  offline: "……応答がない。接続を確認しろ。",
  stream:  "……途中で途切れた。まあいい。",
  http:    (status) => `シーマンは今、話せないようだ。（${status}）`,
  stt:     "……何言ってるか分からねえな。",
  mic_denied:  "マイクを使わせろ。",
  mic_missing: "マイクが見つからねえ。",
  wasm:    "シーマンの耳がまだ開いてない。リロードしろ。",
  webgl:              "シーマンが眠ったままだ。最新のブラウザを使え。",
  memory_unavailable:    "シーマンは記憶喪失だ。会話は続けられるが、過去を覚えていない。",
  voicevox_unavailable:  "VOICEVOX が見つからない。標準音声で代替する。",
  unknown:            "……何かがおかしい。",
};

const VOICE_STATE_LABELS = {
  idle:         "",
  listening:    "👂 聴いてる",
  transcribing: "⏳ 転写中",
  thinking:     "💭 考えてる",
  speaking:     "🔊 喋ってる",
};

export function initChatRenderer({ logEl, thinkingEl, voiceStateEl }) {
  if (!logEl) throw new Error("[renderer] logEl is required");

  const bubbles = new Map(); // message id → DOM element
  let pendingTranscriptionBubble = null; // 転写中の仮バブル

  // ── ユーザー発話 ─────────────────────────────────────────────────────────
  chatStore.on("userMessage", (msg) => {
    // 転写中の仮バブルを確定テキストで置き換える
    if (pendingTranscriptionBubble) {
      pendingTranscriptionBubble.textContent = msg.content;
      pendingTranscriptionBubble.dataset.state = "done";
      pendingTranscriptionBubble.dataset.msgId = String(msg.id);
      bubbles.set(msg.id, pendingTranscriptionBubble);
      pendingTranscriptionBubble = null;
    } else {
      const el = createBubble("user", msg.content);
      el.dataset.state = "done";
      el.dataset.msgId = String(msg.id);
      logEl.appendChild(el);
      bubbles.set(msg.id, el);
    }
    scrollToBottom(logEl);
  });

  // ── アシスタント ストリーミング ────────────────────────────────────────────
  chatStore.on("assistantChunk", ({ id, chunk }) => {
    let el = bubbles.get(id);
    if (!el) {
      el = createBubble("seaman", "");
      el.dataset.state = "streaming";
      el.dataset.msgId = String(id);
      logEl.appendChild(el);
      bubbles.set(id, el);
    }
    el.textContent += chunk;
    scrollToBottom(logEl);
  });

  chatStore.on("assistantDone", ({ id }) => {
    const el = bubbles.get(id);
    if (el) el.dataset.state = "done";
    scrollToBottom(logEl);
  });

  // ── エラー ───────────────────────────────────────────────────────────────
  chatStore.on("error", ({ id, error }) => {
    const text = renderErrorText(error);
    const el = id ? bubbles.get(id) : null;
    if (el) {
      if (!el.textContent) {
        el.textContent = text;
      } else {
        appendErrorBubble(logEl, text);
      }
      el.dataset.state = "error";
    } else {
      appendErrorBubble(logEl, text);
    }
    scrollToBottom(logEl);
  });

  // ── Thinking ─────────────────────────────────────────────────────────────
  if (thinkingEl) {
    chatStore.on("thinking", ({ active }) => { thinkingEl.hidden = !active; });
    thinkingEl.hidden = true;
  }

  // ── Voice State インジケーター ────────────────────────────────────────────
  if (voiceStateEl) {
    chatStore.on("voiceState", (state) => {
      const label = VOICE_STATE_LABELS[state] ?? state;
      voiceStateEl.textContent = label;
      voiceStateEl.className = state === "idle" ? "" : `${state} visible`;

      // transcribing: 転写中の仮バブルを表示
      if (state === "transcribing") {
        if (!pendingTranscriptionBubble) {
          pendingTranscriptionBubble = createBubble("user", "（転写中…）");
          pendingTranscriptionBubble.dataset.state = "streaming";
          logEl.appendChild(pendingTranscriptionBubble);
          scrollToBottom(logEl);
        }
      } else if (pendingTranscriptionBubble && state !== "transcribing") {
        // transcribing でなくなったのに仮バブルが残っている場合（空文字スキップ等）は削除
        pendingTranscriptionBubble.remove();
        pendingTranscriptionBubble = null;
      }
    });
  }

  // assistantSentence は lip-sync.js 側で購読するため、ここでは何もしない
}

function createBubble(kind, text) {
  const el = document.createElement("div");
  el.className = kind === "user" ? "bubble bubble-user" : "bubble bubble-seaman";
  el.textContent = text;
  return el;
}

function appendErrorBubble(logEl, text) {
  const el = createBubble("seaman", text);
  el.dataset.state = "error";
  logEl.appendChild(el);
}

function scrollToBottom(logEl) {
  logEl.scrollTop = logEl.scrollHeight;
}

function renderErrorText(err) {
  if (err instanceof OllamaError) {
    if (err.kind === "http") return ERROR_LINES.http(err.status ?? "?");
    return ERROR_LINES[err.kind] ?? ERROR_LINES.unknown;
  }
  // kind ベースで ERROR_LINES から引く（Phase 2〜 追加分をすべてカバー）
  if (err?.kind && ERROR_LINES[err.kind]) {
    const line = ERROR_LINES[err.kind];
    return typeof line === "function" ? line(err.status ?? "?") : line;
  }
  return ERROR_LINES.unknown;
}
