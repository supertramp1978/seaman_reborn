// ゲームステート管理: localStorage への永続化を担う。
// 公開 API: getDefaultState / loadState / saveState

const STORAGE_KEY = "seaman_state";

export function getDefaultState() {
  return {
    seaman: {
      mood: "neutral",
      trust: 0,
      age_days: 0,
      stage: "adult", // Phase 1 は adult から開始
      last_interaction: new Date().toISOString(),
    },
    player: {
      name: null,
      known_facts: {},
    },
    stats: {
      total_conversations: 0,
      total_touches: 0,
    },
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw);
    // スキーマ欠損があってもデフォルトでマージしておく（将来のフィールド追加を許容）。
    return mergeDeep(getDefaultState(), parsed);
  } catch (err) {
    console.warn("[game] loadState failed, using defaults:", err);
    return getDefaultState();
  }
}

// partial: { seaman?: {...}, player?: {...}, stats?: {...} }
// 部分マージで保存し、last_interaction を自動更新する。
export function saveState(partial = {}) {
  const current = loadState();
  const next = mergeDeep(current, partial);
  next.seaman.last_interaction = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("[game] saveState failed:", err);
  }
  return next;
}

// シンプルなディープマージ（プレーンオブジェクトのみ想定）
function mergeDeep(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch ?? base;
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    out[key] = isPlainObject(base[key]) && isPlainObject(patch[key])
      ? mergeDeep(base[key], patch[key])
      : patch[key];
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Phase 4: player.known_facts を更新して localStorage に保存する。
 * subject: "player.name" → known_facts.name = value
 * subject: "player.likes" → known_facts.likes = value (配列)
 */
export function addKnownFact(subject, value) {
  const key   = subject.split('.').pop();
  const state = loadState();
  saveState({ player: { known_facts: { ...state.player.known_facts, [key]: value } } });
}
