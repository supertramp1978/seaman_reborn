// static-voice.js: 静的会話イベントの音声再生管理
// イベント名→音声ファイルのマニフェストを一箇所で管理する。
// 音声ファイルの差し替え・追加は VOICE_MANIFEST を編集するだけでよい。

import { se } from './se.js';

// ── マニフェスト ────────────────────────────────────────────────────────────
// 差し替え時はパスを書き換えるだけ。MP3 / WAV どちらでも可。
const VOICE_MANIFEST = {
  game_start:               'assets/audio/voice/game_start.wav',
  game_resume:              'assets/audio/voice/game_resume.wav',
  keyword_match:            'assets/audio/voice/keyword_match.wav',
  water_temp_high:          'assets/audio/voice/water_temp_high.wav',
  water_temp_low:           'assets/audio/voice/water_temp_low.wav',
  water_quality_bad:        'assets/audio/voice/water_quality_bad.wav',
  water_quality_good:       'assets/audio/voice/water_quality_good.wav',
  mood_up:                  'assets/audio/voice/mood_up.wav',
  mood_down:                'assets/audio/voice/mood_down.wav',
  trust_up:                 'assets/audio/voice/trust_up.wav',
  trust_down:               'assets/audio/voice/trust_down.wav',
  stage_larva_to_juvenile:  'assets/audio/voice/stage_larva_to_juvenile.wav',
  stage_juvenile_to_adult:  'assets/audio/voice/stage_juvenile_to_adult.wav',
  stage_adult_to_new_species: 'assets/audio/voice/stage_adult_to_new_species.wav',
};

// ── キーワード設定 ─────────────────────────────────────────────────────────
// 追加するときはここに単語を足すだけ（大文字小文字は正規化済み）
export const TRIGGER_KEYWORDS = [
  'シーマン',
  'さかな',
  '魚',
  'おはよう',
  'こんにちは',
  'こんばんは',
];

// ── クールダウン ────────────────────────────────────────────────────────────
const COOLDOWN_MS = 5 * 60 * 1000; // 5分
const _lastFired  = new Map();      // eventName → timestamp

// ── 公開 API ────────────────────────────────────────────────────────────────

/** マニフェスト全バッファをロードする。main.js の初期化フローで1回呼ぶ。 */
export async function initStaticVoice() {
  await Promise.all(
    Object.entries(VOICE_MANIFEST).map(([name, url]) => se.loadBuffer(name, url))
  );
  console.debug('[static-voice] 全バッファ読み込み完了');
}

/**
 * 指定イベントの音声を再生する。クールダウン中は無視。
 * @param {string} eventName - VOICE_MANIFEST のキー
 * @param {{ force?: boolean }} options - force:true でクールダウンを無視
 */
export function triggerVoiceEvent(eventName, { force = false } = {}) {
  if (!VOICE_MANIFEST[eventName]) {
    console.warn(`[static-voice] 未定義のイベント: ${eventName}`);
    return;
  }

  if (!force) {
    const last = _lastFired.get(eventName) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      console.debug(`[static-voice] クールダウン中: ${eventName}`);
      return;
    }
  }

  _lastFired.set(eventName, Date.now());
  se.playOneShot(eventName);
  console.debug(`[static-voice] 再生: ${eventName}`);
}

/**
 * テキストにキーワードが含まれていれば keyword_match を発火する。
 * main.js の userMessage リスナーから呼ぶ。
 * @param {string} text
 */
export function checkKeywordAndTrigger(text) {
  const normalized = text.toLowerCase();
  const hit = TRIGGER_KEYWORDS.some(kw => normalized.includes(kw.toLowerCase()));
  if (hit) triggerVoiceEvent('keyword_match');
}
