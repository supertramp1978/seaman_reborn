import { getFact, saveFact } from './db.js';
import { addKnownFact } from '../state/game.js';

const ARRAY_SUBJECTS = new Set(['player.likes', 'player.dislikes']);

const PATTERNS = [
  {
    // 「私は太郎です」「僕の名前は太郎だ」
    regex: /(私|僕|俺|あたし)(の名前)?は\s*([\p{L}\p{N}ー]+?)\s*(と|だ|です|っていう|だよ)/u,
    subject: 'player.name',
    group: 3,
    confidence: 0.85,
  },
  {
    // 「タロって呼んで」
    regex: /([\p{L}\p{N}ー]+?)\s*(と|って)\s*呼んで/u,
    subject: 'player.nickname',
    group: 1,
    confidence: 0.80,
  },
  {
    // 「ラーメンが好き」「うどんが好物」
    regex: /([\p{L}\p{N}ーー]+?)\s*が\s*(好き|好物)/u,
    subject: 'player.likes',
    group: 1,
    confidence: 0.75,
  },
  {
    // 「納豆が嫌い」「ピーマンが苦手」
    regex: /([\p{L}\p{N}ーー]+?)\s*が\s*(嫌い|苦手)/u,
    subject: 'player.dislikes',
    group: 1,
    confidence: 0.75,
  },
];

export function extractFacts(userText) {
  const facts = [];
  for (const { regex, subject, group, confidence } of PATTERNS) {
    const m = regex.exec(userText);
    if (m) {
      facts.push({ subject, value: m[group].trim(), confidence });
    }
  }
  return facts;
}

export async function applyFacts(facts, sourceTurnId) {
  for (const { subject, value, confidence } of facts) {
    try {
      let storedValue = value;

      if (ARRAY_SUBJECTS.has(subject)) {
        // 配列型: 既存配列を読んで重複排除 append
        const existing = await getFact(subject);
        const arr = Array.isArray(existing?.value) ? existing.value : [];
        if (arr.includes(value)) continue;
        storedValue = [...arr, value];
      }

      await saveFact({ subject, value: storedValue, confidence, source_turn_id: sourceTurnId });
      addKnownFact(subject, storedValue);
      console.debug(`[profile] saved: ${subject} = ${JSON.stringify(storedValue)}`);
    } catch (e) {
      console.warn('[profile] applyFacts error:', e.message);
    }
  }
}
