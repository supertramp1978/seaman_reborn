import { VOICEVOX_URL, VOICEVOX_SPEAKER_ID } from "../../config/env.js";

/**
 * VOICEVOX Engine が起動しているか確認する。
 * @returns {Promise<boolean>}
 */
export async function checkVoicevox() {
  try {
    const resp = await fetch(`${VOICEVOX_URL}/speakers`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * テキストを WAV の ArrayBuffer に合成する。
 * @param {string} text
 * @param {number} speakerId
 * @returns {Promise<ArrayBuffer>}
 */
export async function synthesizeText(text, speakerId = VOICEVOX_SPEAKER_ID) {
  // 1. audio_query: テキスト → 音声合成パラメータ JSON
  const qResp = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: "POST" },
  );
  if (!qResp.ok) throw new Error(`[voicevox] audio_query ${qResp.status}`);
  const audioQuery = await qResp.json();

  // 2. synthesis: パラメータ → WAV バイナリ
  const sResp = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(audioQuery),
  });
  if (!sResp.ok) throw new Error(`[voicevox] synthesis ${sResp.status}`);
  return sResp.arrayBuffer();
}
