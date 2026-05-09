#!/bin/bash
# whisper.cpp を Emscripten でビルドし、WASM 成果物を WEBROOT に配置する。
# EC2 UserData (setup-instance.sh Phase 2) とローカル開発の両方で使用可能。
#
# 使い方:
#   bash scripts/build-whisper-wasm.sh [WEBROOT]
#   WEBROOT のデフォルト = スクリプトの親ディレクトリ (= リポジトリルート)
#
# 前提:
#   cmake, make, python3, git がインストール済みであること

set -euo pipefail

WEBROOT=${1:-$(cd "$(dirname "$0")/.." && pwd)}
EMSDK_DIR=${EMSDK_DIR:-/opt/emsdk}
WHISPER_DIR=${WHISPER_DIR:-/opt/whisper.cpp}
WHISPER_WASM_OUT="${WEBROOT}/assets/wasm/whisper"
GGML_MODEL_OUT="${WEBROOT}/assets/wasm"
MODEL_NAME="ggml-tiny.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}"

log() { echo "[build-whisper-wasm] $(date '+%H:%M:%S') $*"; }

# ─── Emscripten SDK (emsdk) ──────────────────────────────────────────
install_emsdk() {
  if [ -d "$EMSDK_DIR" ]; then
    log "emsdk: 既インストール済み — アクティベートのみ"
    cd "$EMSDK_DIR"
    git pull -q
  else
    log "emsdk: インストール"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
    cd "$EMSDK_DIR"
  fi

  ./emsdk install latest
  ./emsdk activate latest
  log "emsdk: アクティベート完了"
}

# ─── whisper.cpp ─────────────────────────────────────────────────────
clone_whisper() {
  if [ -d "$WHISPER_DIR/.git" ]; then
    log "whisper.cpp: 既存 — git pull"
    git -C "$WHISPER_DIR" pull -q
  else
    log "whisper.cpp: clone"
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_DIR"
  fi
}

# ─── WASM ビルド ─────────────────────────────────────────────────────
build_wasm() {
  log "WASM ビルド開始 (数分かかります)"

  # emsdk 環境を読み込む
  # shellcheck disable=SC1091
  source "${EMSDK_DIR}/emsdk_env.sh"

  cd "$WHISPER_DIR"

  # whisper.cpp の WASM ターゲット
  # examples/stream.wasm または libwhisper.js を生成する
  mkdir -p build-wasm
  cd build-wasm

  emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DWHISPER_WASM=ON \
    -DWHISPER_SDL2=OFF \
    -DBUILD_SHARED_LIBS=OFF

  emmake make -j"$(nproc)" whisper.wasm 2>&1 | tail -20

  log "WASM ビルド完了"
}

# ─── 成果物コピー ────────────────────────────────────────────────────
copy_artifacts() {
  mkdir -p "$WHISPER_WASM_OUT"

  # ビルドされた主要ファイルを探してコピー
  find "${WHISPER_DIR}/build-wasm" -maxdepth 3 \
    \( -name "*.js" -o -name "*.wasm" -o -name "*.worker.js" \) \
    | while read -r f; do
      cp "$f" "$WHISPER_WASM_OUT/"
      log "コピー: $(basename "$f") → $WHISPER_WASM_OUT/"
    done

  # 代替: examples/ 以下の libmain.js 等
  find "${WHISPER_DIR}" -maxdepth 4 -name "libmain.js" -o -name "libmain.wasm" \
    2>/dev/null | while read -r f; do
      cp "$f" "$WHISPER_WASM_OUT/"
      log "コピー (libmain): $(basename "$f") → $WHISPER_WASM_OUT/"
    done

  log "成果物コピー完了: $WHISPER_WASM_OUT/"
}

# ─── ggml-tiny.bin ダウンロード ──────────────────────────────────────
download_model() {
  local dest="${GGML_MODEL_OUT}/${MODEL_NAME}"

  if [ -f "$dest" ]; then
    log "モデル: 既存 — スキップ ($dest)"
    return
  fi

  log "ggml-tiny.bin をダウンロード (~75MB)"
  mkdir -p "$GGML_MODEL_OUT"
  curl -fL --progress-bar -o "$dest" "$MODEL_URL"
  log "ダウンロード完了: $dest"
}

# ─── メイン ──────────────────────────────────────────────────────────
log "=== whisper.cpp WASM ビルド開始 ==="
log "WEBROOT=$WEBROOT"

install_emsdk
clone_whisper
build_wasm
copy_artifacts
download_model

log "=== 完了 ==="
log "成果物: $WHISPER_WASM_OUT/"
ls -lh "$WHISPER_WASM_OUT/" 2>/dev/null || true
