// 環境設定: ローカル開発と EC2 デプロイで OLLAMA_URL を切り替える。
// MODEL_NAME と OLLAMA_OPTIONS は config 定数として外出しし、後続フェーズで調整する。

const isLocal =
  typeof location !== "undefined" &&
  (location.hostname === "localhost" || location.hostname === "127.0.0.1");

export const OLLAMA_URL = isLocal ? "http://localhost:11434" : "";

export let MODEL_NAME = "dsasai/llama3-elyza-jp-8b:latest";

export const FALLBACK_MODEL_NAME = "gemma3:4b";

export const OLLAMA_OPTIONS = {
  temperature: 0.8,
  repeat_penalty: 1.15,
  num_ctx: 4096,
  num_predict: 256,
};

// VOICEVOX Engine（ローカルまたは同一ホスト）
export const VOICEVOX_URL = isLocal ? "http://localhost:50021" : "/voicevox";

// スピーカー ID: /speakers エンドポイントで確認して変更
export const VOICEVOX_SPEAKER_ID = 66;

// URL クエリ ?model=... で実行時上書きするためのフック。main.js から呼ばれる。
export function overrideModelName(name) {
  if (typeof name === "string" && name.length > 0) {
    MODEL_NAME = name;
  }
}

export function getModelName() {
  return MODEL_NAME;
}
