import { getAllConversations } from './db.js';

export async function retrieveSimilar(queryEmbedding, {
  topK = 3,
  threshold = 0.85, // 実測: 日本語短文は 0.79-0.88 レンジ。0.85 以上を「明確に関連」と判定。不自然な引用を避けるため高めに設定
  excludeRecentN = 2,
} = {}) {
  if (!queryEmbedding) return [];

  const all = await getAllConversations();
  if (all.length === 0) return [];

  const maxTurn = Math.max(...all.map(c => c.turn_index));
  const cutoff  = maxTurn - excludeRecentN; // 直近 N ターンは即時履歴側に任せる

  const scored = all
    .filter(c => c.turn_index <= cutoff && Array.isArray(c.user_embedding))
    .map(c => ({ ...c, similarity: cosineSimilarity(queryEmbedding, c.user_embedding) }))
    .filter(c => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  if (scored.length > 0) {
    console.debug(
      '[memory] retrieved',
      scored.length,
      scored.map(m => `"${m.user_text.slice(0, 20)}" (${m.similarity.toFixed(3)})`),
    );
  }

  return scored;
}

export function cosineSimilarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function formatMemoryForPrompt(memory) {
  const elapsed = Date.now() - new Date(memory.timestamp).getTime();
  const days    = Math.floor(elapsed / 86_400_000);
  const label   = days === 0 ? 'さっき'
    : days === 1 ? '昨日'
    : `${days}日前`;

  // シーマン視点の事実文として提示（会話ログではなく「こいつが言った事実」として）
  const user = memory.user_text.replace(/\n/g, ' ').slice(0, 80);
  return `- (${label}) こいつが「${user}」と言っていた`;
}
