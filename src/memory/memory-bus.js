import { embed, getEmbedderStatus } from './embedder.js';
import { openDB, saveConversation, getFacts, getNextTurnIndex } from './db.js';
import { retrieveSimilar, formatMemoryForPrompt } from './retrieval.js';
import { extractFacts, applyFacts } from './profile.js';

let _ready = false;
let _conversationCount = 0;

export async function initMemoryBus() {
  try {
    await openDB();
    _ready = true;
    console.debug('[memory-bus] ready');
  } catch (e) {
    console.warn('[memory-bus] IndexedDB init failed:', e.message);
    _ready = false;
  }
}

/**
 * 発話前に呼ぶ。embedding + retrieval + profile を返す。
 * 未ロード・エラー時は空の context を返す（throw しない）。
 */
export async function prepareContext(userText) {
  const empty = { memories: [], profile: {}, queryEmbedding: null };
  if (!_ready) return empty;

  const { loaded } = getEmbedderStatus();
  if (!loaded) return empty;

  try {
    const t0 = performance.now();

    const queryEmbedding = await embed(userText, 'query');
    const t1 = performance.now();

    const similar = await retrieveSimilar(queryEmbedding);
    const t2 = performance.now();

    const factsArr = await getFacts();
    const t3 = performance.now();

    const memories = similar.map(formatMemoryForPrompt);
    const profile  = _factsToProfile(factsArr);

    console.debug(
      `[perf-mem] embed_query_ms=${(t1 - t0).toFixed(0)} retrieve_ms=${(t2 - t1).toFixed(0)} facts_ms=${(t3 - t2).toFixed(0)}`,
    );

    return { memories, profile, queryEmbedding };
  } catch (e) {
    console.warn('[memory-bus] prepareContext error:', e.message);
    return empty;
  }
}

/**
 * 発話完了後に呼ぶ。会話を保存して fact を抽出する（fire-and-forget 可）。
 */
export async function commitTurn({ userText, assistantText, queryEmbedding }) {
  if (!_ready) return;

  const t0 = performance.now();
  try {
    if (queryEmbedding) {
      const turnIndex = await getNextTurnIndex();
      await saveConversation({
        user_text: userText,
        assistant_text: assistantText,
        user_embedding: queryEmbedding,
        turn_index: turnIndex,
      });
      _conversationCount++;
    }

    const facts = extractFacts(userText);
    if (facts.length > 0) {
      await applyFacts(facts, _conversationCount);
    }

    console.debug(`[perf-mem] commit_ms=${(performance.now() - t0).toFixed(0)}`);
  } catch (e) {
    console.warn('[memory-bus] commitTurn error:', e.message);
  }
}

export function getMemoryStatus() {
  return { ready: _ready, conversationCount: _conversationCount };
}

function _factsToProfile(factsArr) {
  const profile = { name: null, nickname: null, likes: [], dislikes: [] };
  for (const fact of factsArr) {
    const key = fact.subject.split('.').pop();
    if (key === 'name' || key === 'nickname') {
      profile[key] = fact.value ?? null;
    } else if (key === 'likes' || key === 'dislikes') {
      profile[key] = Array.isArray(fact.value) ? fact.value : (fact.value ? [fact.value] : []);
    }
  }
  return profile;
}
