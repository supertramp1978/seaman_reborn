// VAD ラッパー: @ricky0123/vad-web (silero-vad) を使って発話の開始/終了を検知する。
// speechEnd で 16kHz Float32Array バッファを返す。
//
// ロード順序:
//   1. onnxruntime-web を先にロードして window.ort を確立する（vad-web の peer dependency）
//   2. vad-web bundle をロード（window.ort が存在することを前提としている）

const VAD_VERSION = "0.0.22";
const ORT_VERSION = "1.14.0";  // vad-web@0.0.22 の peer dependency
const VAD_BASE    = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist`;
const ORT_CDN     = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.min.js`;
const VAD_CDN     = `${VAD_BASE}/bundle.min.js`;
const WORKLET_URL = `${VAD_BASE}/vad.worklet.bundle.min.js`;
const MODEL_URL   = `${VAD_BASE}/silero_vad.onnx`;

let vadLib = null;
let micVad = null;
let _onSpeechStart = null;
let _onSpeechEnd   = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureLib() {
  if (vadLib) return vadLib;

  // 1. onnxruntime-web を先にロード（window.ort が未設定の場合のみ）
  if (!window.ort) {
    console.debug("[vad] loading onnxruntime-web...");
    await loadScript(ORT_CDN);
    console.debug("[vad] ort ready, env:", typeof window.ort?.env);
  }

  // 2. vad-web bundle をロード
  vadLib = await new Promise((resolve, reject) => {
    if (window.vad) { resolve(window.vad); return; }
    const s = document.createElement("script");
    s.src     = VAD_CDN;
    s.onload  = () => {
      if (!window.vad) { reject(new Error("vad-web ロード後も window.vad が undefined")); return; }
      resolve(window.vad);
    };
    s.onerror = () => reject(new Error(`vad-web CDN ロード失敗: ${VAD_CDN}`));
    document.head.appendChild(s);
  });

  console.debug("[vad] loaded:", Object.keys(vadLib).join(", "));
  return vadLib;
}

/**
 * VAD ライブラリだけロードする（マイク許可は要求しない）。
 * プリロード時に呼ぶ。
 */
export async function loadVadLib() {
  await ensureLib();
  console.debug("[vad] library ready (mic not yet requested)");
}

/**
 * VAD を初期化する（MicVAD.new() でマイク許可を要求する）。
 * ボタン押下時に呼ぶ。
 * @param {{ onSpeechStart: ()=>void, onSpeechEnd: (Float32Array)=>void }} opts
 */
export async function initVad({ onSpeechStart, onSpeechEnd }) {
  _onSpeechStart = onSpeechStart;
  _onSpeechEnd   = onSpeechEnd;

  const lib = await ensureLib();

  micVad = await lib.MicVAD.new({
    workletURL: WORKLET_URL,
    modelURL:   MODEL_URL,
    onSpeechStart: () => {
      console.debug("[vad] speechStart");
      _onSpeechStart?.();
    },
    onSpeechEnd: (audio) => {
      console.debug(`[vad] speechEnd: ${audio.length} samples (${(audio.length / 16000).toFixed(2)}s)`);
      _onSpeechEnd?.(audio);
    },
    onVADMisfire: () => {
      console.debug("[vad] misfire (short segment, ignored)");
    },
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.45,
    minSpeechFrames:  3,
    redemptionFrames: 10,
  });

  console.debug("[vad] MicVAD initialized");
}

export function getMicVad() { return micVad; }

export function startVad() {
  if (!micVad) throw new Error("[vad] initVad() を先に呼んでください");
  micVad.start();
}

export function stopVad() {
  micVad?.destroy();
  micVad = null;
}

export function pauseVad() { micVad?.pause(); }
export function resumeVad() { micVad?.start(); }
