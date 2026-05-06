// Ollama /api/chat クライアント。ストリーミング対応。
// streaming.js から呼ばれ、トークン/完了/エラーを各コールバックに通知する。

import { OLLAMA_URL, OLLAMA_OPTIONS, getModelName } from "../../config/env.js";

export class OllamaError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = "OllamaError";
    this.kind = kind; // "offline" | "http" | "stream" | "abort"
    this.status = status ?? null;
  }
}

/**
 * /api/chat にストリーミングでリクエストを送る。
 * @param {object} args
 * @param {Array} args.messages messages 配列（system/user/assistant）
 * @param {(line: object) => void} args.onLine NDJSON 1 行ごとのコールバック
 * @param {AbortSignal} [args.signal] AbortController.signal
 */
export async function chatStream({ messages, onLine, signal }) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getModelName(),
        messages,
        stream: true,
        options: OLLAMA_OPTIONS,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new OllamaError("aborted", "abort");
    }
    // TypeError: Failed to fetch → Ollama 未起動 or CORS/ネットワーク不通
    throw new OllamaError(
      `Ollama に接続できない: ${err?.message ?? err}`,
      "offline",
    );
  }

  if (!response.ok) {
    throw new OllamaError(
      `HTTP ${response.status} ${response.statusText}`,
      "http",
      response.status,
    );
  }
  if (!response.body) {
    throw new OllamaError("response body が空", "stream");
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream("utf-8"))
    .getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // NDJSON: \n 区切りで 1 メッセージ
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          console.warn("[ollama] JSON parse failed for line:", line, err);
          continue;
        }
        onLine(parsed);
      }
    }
    // バッファ末尾に残った 1 行（通常は最終 done メッセージか改行で空）
    const tail = buffer.trim();
    if (tail) {
      try {
        onLine(JSON.parse(tail));
      } catch (err) {
        console.warn("[ollama] tail JSON parse failed:", tail, err);
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new OllamaError("aborted", "abort");
    }
    throw new OllamaError(
      `ストリームが切断された: ${err?.message ?? err}`,
      "stream",
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // noop
    }
  }
}
