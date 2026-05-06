#!/usr/bin/env node
// 静的ファイルサーバー。COOP/COEP ヘッダーを全レスポンスに付与する。
// SharedArrayBuffer (Whisper.cpp WASM マルチスレッド) に必要。
// 使い方: node scripts/dev-server.js [port]

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8181);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".bin":  "application/octet-stream",
  ".onnx": "application/octet-stream",
  ".glb":  "model/gltf-binary",
  ".wav":  "audio/wav",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

// キャッシュ対象（大容量で不変のファイル）
const IMMUTABLE_EXTS = new Set([".wasm", ".bin", ".onnx", ".glb"]);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // ディレクトリは index.html にフォールバック
  if (pathname.endsWith("/")) pathname += "index.html";

  const filePath = path.join(ROOT, pathname);

  // ディレクトリトラバーサル防止
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA フォールバック: 404 の場合は index.html を返す
      const fallback = path.join(ROOT, "index.html");
      fs.stat(fallback, (e2) => {
        if (e2) { res.writeHead(404); res.end("Not Found"); return; }
        serveFile(res, fallback, "text/html; charset=utf-8", false);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    const immutable = IMMUTABLE_EXTS.has(ext);
    serveFile(res, filePath, mime, immutable);
  });
});

function serveFile(res, filePath, mime, immutable) {
  const cacheControl = immutable
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  res.writeHead(200, {
    "Content-Type":                 mime,
    "Cache-Control":                cacheControl,
    // Whisper.cpp WASM の SharedArrayBuffer に必要
    "Cross-Origin-Opener-Policy":   "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
    // CORS: Ollama 直呼び出し時のブラウザ制約を回避
    "Access-Control-Allow-Origin":  "*",
  });

  fs.createReadStream(filePath).pipe(res);
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  ✗ Port ${PORT} is already in use.`);
    console.error(`    Run:  kill $(lsof -ti :${PORT})`);
    console.error(`    Or:   PORT=${PORT + 1} node scripts/dev-server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  Dev server: http://localhost:${PORT}`);
  console.log(`  COOP/COEP  : enabled (SharedArrayBuffer available)`);
  console.log(`  Root       : ${ROOT}\n`);
});
