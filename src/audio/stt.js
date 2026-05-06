// STT ラッパー: Whisper.cpp WASM を使って音声バッファを日本語テキストに変換する。
//
// ─── 確定 API (emscripten.cpp + index-tmpl.html で確認済み) ──────────────────
// ロード:    window.Module = { print, printErr } を設定後に script タグで libmain.js を読む
//            → Module.onRuntimeInitialized で初期化完了
// FS 書き込み: Module.FS_unlink(name) → Module.FS_createDataFile("/", name, Uint8Array, true, true)
// init:       Module.init("whisper.bin") → 1-based context index (0 = 失敗)
// 転写:       Module.full_default(index, Float32Array, "ja", threads, false)
//             → 内部 pthread で非同期実行、即 0 を return
//             → テキストは Module.print callback に "[HH:MM:SS.mmm --> HH:MM:SS.mmm]  TEXT" 形式で出力
//             → "total time" 行で完了検知
// ─────────────────────────────────────────────────────────────────────────────

const WHISPER_JS  = "/assets/wasm/whisper/libmain.js";
const MODEL_PATH  = "/assets/wasm/ggml-tiny.bin";
const MODEL_NAME  = "whisper.bin";

// whisper は libmain.js がグローバル変数 Module を使うため window.Module で保持する
let _module = null;
let _instance = null;  // 1-based context index
let _modelLoaded = false;

// Emscripten は print/printErr を初期化時にローカル変数へ束縛するため、
// 初期化後の Module.print 上書きは届かない。
// プロキシパターン: Module.print/printErr は常にこのハンドラを呼ぶ。
// transcribe() 側でハンドラを差し替えてキャプチャする。
let _captureHandler = null;

function resolveThreads(mode) {
  if (mode === "single") return 1;
  const isolated = typeof self !== "undefined" && self.crossOriginIsolated === true;
  const sabOk    = typeof SharedArrayBuffer !== "undefined";
  if (!isolated || !sabOk) {
    console.warn("[stt] crossOriginIsolated 不可 → シングルスレッド");
    return 1;
  }
  return Math.min(navigator.hardwareConcurrency ?? 4, 8);
}

/**
 * WASM モジュールとモデルをロードする。
 * @param {{ onProgress?: (n: number) => void }} opts
 */
export async function loadModel({ onProgress } = {}) {
  if (_modelLoaded) return;

  // 1. window.Module を事前設定（libmain.js がグローバル Module を参照するため）
  await new Promise((resolve, reject) => {
    window.Module = {
      print:    (text) => { console.debug("[whisper]", text);     _captureHandler?.(text); },
      printErr: (text) => { console.warn("[whisper-err]", text);  _captureHandler?.(text); },
      setStatus: () => {},
      monitorRunDependencies: () => {},
      onRuntimeInitialized: resolve,
    };

    // 2. script タグで libmain.js を読み込む（ES module import は不可）
    const script = document.createElement("script");
    script.src = WHISPER_JS;
    script.onerror = () => reject(new Error(`libmain.js の読み込みに失敗: ${WHISPER_JS}`));
    document.head.appendChild(script);
  });

  _module = window.Module;
  console.debug("[stt] WASM runtime initialized");

  // 3. モデルファイルをフェッチ → Emscripten FS に書き込む
  const response = await fetch(MODEL_PATH);
  if (!response.ok) throw new Error(`[stt] model fetch failed: ${response.status}`);
  const total = Number(response.headers.get("Content-Length") ?? 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress?.(received / total);
  }
  const bytes = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }

  // 既存ファイルを削除してから書き込む（再ロード時のエラーを防ぐ）
  try { _module.FS_unlink(MODEL_NAME); } catch {}
  _module.FS_createDataFile("/", MODEL_NAME, bytes, true, true);
  console.debug(`[stt] model written to FS: ${(received / 1024 / 1024).toFixed(1)} MB`);

  // 4. whisper_init
  _instance = _module.init(MODEL_NAME);
  if (!_instance) throw new Error("[stt] Module.init() failed (returned 0)");
  console.debug("[stt] whisper initialized, instance:", _instance);

  _modelLoaded = true;
}

/**
 * Float32Array (16kHz mono) → 日本語テキスト
 * @param {Float32Array} float32Pcm16k
 * @param {"auto"|"multi"|"single"} threadMode
 * @returns {Promise<string>}
 */
export function transcribe(float32Pcm16k, threadMode = "auto") {
  if (!_modelLoaded || !_module || !_instance) {
    return Promise.reject(new Error("[stt] loadModel() を先に呼んでください"));
  }

  return new Promise((resolve, reject) => {
    const lines = [];
    const t0 = performance.now();
    const threads = resolveThreads(threadMode);

    // Emscripten がローカル変数に束縛した print/printErr はモジュール外から上書き不可。
    // loadModel() で設定したプロキシ関数が _captureHandler を経由するので、
    // ここではハンドラを差し替えるだけでキャプチャが成立する。
    _captureHandler = (text) => lines.push(text);
    const cleanup = () => { _captureHandler = null; };

    // full_default は内部 pthread を起動して即 return する
    // → setTimeout(fn, 100) で非同期呼び出しする（公式デモ準拠）
    setTimeout(() => {
      const ret = _module.full_default(_instance, float32Pcm16k, "ja", threads, false);
      if (ret !== 0) {
        cleanup();
        reject(new Error(`[stt] full_default returned ${ret}`));
        return;
      }

      // "total time" 行が来たら転写完了
      const TIMEOUT_MS = 30_000;
      const deadline = performance.now() + TIMEOUT_MS;

      const poll = () => {
        if (performance.now() > deadline) {
          cleanup();
          reject(new Error("[stt] transcription timeout"));
          return;
        }
        if (!lines.some(l => l.includes("total time"))) {
          setTimeout(poll, 100);
          return;
        }
        cleanup();
        const decodeMs = performance.now() - t0;
        const rtf = decodeMs / (float32Pcm16k.length / 16); // ms / ms
        console.debug(`[stt] decode ${decodeMs.toFixed(0)}ms RTF=${rtf.toFixed(3)} threads=${threads}`);

        // "[HH:MM:SS.mmm --> HH:MM:SS.mmm]  TEXT" 形式からテキストを抽出
        const text = lines
          .filter(l => /^\[[\d:.]+\s*-->\s*[\d:.]+\]/.test(l))
          .map(l => l.replace(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, ""))
          .join("")
          .trim();

        resolve(text);
      };
      setTimeout(poll, 100);
    }, 100);
  });
}

export function isModelLoaded() {
  return _modelLoaded;
}
