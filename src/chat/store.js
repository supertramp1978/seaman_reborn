// ChatStore: EventEmitter 風 Observer。
// Phase 4 追加: memory-bus 連携（prepareContext / commitTurn）、HISTORY_TURN_LIMIT 10 → 2。

import { chatStream, OllamaError } from './ollama.js';
import { StreamingHandler } from './streaming.js';
import { buildMessages } from './prompt.js';
import { loadState, saveState } from '../state/game.js';
import * as memoryBus from '../memory/memory-bus.js';

const HISTORY_TURN_LIMIT = 2; // 即時履歴。長期記憶は RAG が担う

class ChatStore {
  #messages = [];
  #listeners = new Map();
  #isStreaming = false;
  #abortController = null;
  #idCounter = 0;
  #voiceState = 'idle';

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
  }

  off(event, fn) {
    this.#listeners.get(event)?.delete(fn);
  }

  emit(event, data) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch (err) {
        console.error(`[store] listener "${event}" threw:`, err);
      }
    }
  }

  getMessages()   { return this.#messages.slice(); }
  isStreaming()   { return this.#isStreaming; }
  abort()         { this.#abortController?.abort(); }

  setVoiceState(state) {
    if (this.#voiceState === state) return;
    this.#voiceState = state;
    this.emit('voiceState', state);
  }

  getVoiceState() { return this.#voiceState; }

  async sendMessage(userText) {
    const text = userText?.trim();
    if (!text || this.#isStreaming) return;

    this.#isStreaming = true;

    // Phase 4: RAG context（未ロード時は空で続行）
    const { memories, profile, queryEmbedding } = await memoryBus.prepareContext(text);

    const userMsg = this.#pushMessage({ role: 'user', content: text, state: 'done' });
    this.emit('userMessage', userMsg);
    this.emit('thinking', { active: true });

    const assistantMsg = this.#pushMessage({ role: 'assistant', content: '', state: 'streaming' });

    const state    = loadState();
    const history  = this.#getHistoryForPrompt(userMsg.id, assistantMsg.id);
    const messages = buildMessages(text, history, state, { memories, profile });

    this.#abortController = new AbortController();
    const handler = new StreamingHandler({
      onToken: (chunk) => {
        if (assistantMsg.content === '') this.emit('thinking', { active: false });
        assistantMsg.content += chunk;
        this.emit('assistantChunk', { id: assistantMsg.id, chunk });
      },
      onSentence: (sentence) => {
        this.emit('assistantSentence', { id: assistantMsg.id, sentence });
      },
      onDone: () => {
        assistantMsg.state = 'done';
        this.#trimHistory();
        this.emit('assistantDone', { id: assistantMsg.id, content: assistantMsg.content });
        saveState({ stats: { total_conversations: state.stats.total_conversations + 1 } });

        // Phase 4: fire-and-forget で会話を保存・fact 抽出
        memoryBus.commitTurn({
          userText: text,
          assistantText: assistantMsg.content,
          queryEmbedding,
        }).catch(e => console.warn('[store] memory commit failed:', e.message));
      },
      onError: (err) => {
        assistantMsg.state = 'error';
        this.emit('error', { id: assistantMsg.id, error: err });
      },
    });

    try {
      await chatStream({
        messages,
        signal: this.#abortController.signal,
        onLine: (line) => handler.handleLine(line),
      });
    } catch (err) {
      if (!(err instanceof OllamaError)) console.error('[store] unexpected error:', err);
      handler.fail(err);
    } finally {
      this.#isStreaming = false;
      this.#abortController = null;
      this.emit('thinking', { active: false });
    }
  }

  #pushMessage({ role, content, state }) {
    const msg = { id: ++this.#idCounter, role, content, state: state ?? 'done' };
    this.#messages.push(msg);
    return msg;
  }

  #getHistoryForPrompt(currentUserId, currentAssistantId) {
    const past = this.#messages.filter(
      m => m.id !== currentUserId && m.id !== currentAssistantId && m.state !== 'error',
    );
    const pairs = [];
    for (let i = past.length - 1; i >= 0; i--) {
      const m = past[i];
      if (m.role === 'assistant' && i > 0 && past[i - 1].role === 'user') {
        pairs.push([past[i - 1], m]);
        i -= 1;
      }
      if (pairs.length >= HISTORY_TURN_LIMIT) break;
    }
    pairs.reverse();
    return pairs.flat();
  }

  #trimHistory() {
    const max = HISTORY_TURN_LIMIT * 2;
    const completed = this.#messages.filter(m => m.state !== 'streaming');
    if (completed.length <= max) return;
    const toRemove = completed.length - max;
    let removed = 0;
    for (let i = 0; i < this.#messages.length && removed < toRemove;) {
      if (this.#messages[i].state !== 'streaming') {
        this.#messages.splice(i, 1);
        removed++;
      } else {
        i++;
      }
    }
  }
}

export const chatStore = new ChatStore();
