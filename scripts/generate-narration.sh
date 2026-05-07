#!/bin/bash
# VOICEVOX でタイトル画面のナレーション WAV を生成する。
# ローカルまたは EC2 上で実行。
#
# 使い方:
#   bash scripts/generate-narration.sh [TEXT] [SPEAKER_ID] [OUTPUT_PATH]
#
# デフォルト:
#   TEXT       = "シーマンへようこそ。"
#   SPEAKER_ID = 66 (config/env.js の VOICEVOX_SPEAKER_ID と合わせること)
#   OUTPUT     = assets/audio/narration_title.wav

set -euo pipefail

VOICEVOX_HOST=${VOICEVOX_HOST:-http://localhost:50021}
TEXT=${1:-"2026年。人類は、自らが万物の霊長であるという過信を、再び揺さぶられることになった。かつてエジプトの壁画に刻まれ、ジャン＝ポール・ガゼー博士がその生涯を捧げて研究した伝説の生物『シーマン』。学界から黙殺され、絶滅したと信じられていたその系譜が、南米の秘境で、文字通り捕獲されたのだ。しかし、我々が手にしたのは、かつての記録に残る個体とは似て非なるものだった。新たに発見されたこの新種は、これまでに確認されたどのシーマンよりも狡猾で、極めて高い知性を備えている。シーマンは、変態を繰り返す生き物だ。マッシュルーマーからギルマンへ、そしてその先へ。だが、この進化した新種がどのような姿に変わり、どのような言葉を水槽の外へ投げかけてくるのか、それを知る者はまだ誰もいない。さあ、マイクの準備はいいか。27年前、我々が交わした禁断の対話の続きを始めよう。ただし、今度の彼は、少しばかり、以前より手強いかもしれないぞ。"}
SPEAKER_ID=${2:-66}
OUTPUT=${3:-assets/audio/narration_title.wav}

log() { echo "[generate-narration] $*"; }

check_voicevox() {
  if ! curl -sf "${VOICEVOX_HOST}/speakers" &>/dev/null; then
    echo "ERROR: VOICEVOX が ${VOICEVOX_HOST} で応答していません" >&2
    echo "  ローカルで起動: ./voicevox_engine/run --host 127.0.0.1 --port 50021" >&2
    exit 1
  fi
}

generate_wav() {
  local text_encoded
  text_encoded=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$TEXT")

  log "音声クエリ生成: スピーカー ${SPEAKER_ID}"
  local query
  query=$(curl -s -X POST \
    "${VOICEVOX_HOST}/audio_query?speaker=${SPEAKER_ID}&text=${text_encoded}")

  if [ -z "$query" ] || echo "$query" | grep -q '"detail"'; then
    echo "ERROR: audio_query 失敗: $query" >&2
    exit 1
  fi

  log "WAV 合成: ${OUTPUT}"
  mkdir -p "$(dirname "$OUTPUT")"
  curl -s -X POST \
    "${VOICEVOX_HOST}/synthesis?speaker=${SPEAKER_ID}" \
    -H "Content-Type: application/json" \
    -d "$query" \
    -o "$OUTPUT"

  local size
  size=$(wc -c < "$OUTPUT")
  if [ "$size" -lt 100 ]; then
    echo "ERROR: WAV が空です ($size bytes)" >&2
    exit 1
  fi

  log "生成完了: ${OUTPUT} ($size bytes)"
}

# 利用可能なスピーカー一覧を表示するサブコマンド
list_speakers() {
  curl -s "${VOICEVOX_HOST}/speakers" \
    | python3 -c "
import json, sys
speakers = json.load(sys.stdin)
for s in speakers:
  for style in s.get('styles', []):
    print(f\"{style['id']:4d}  {s['name']} / {style['name']}\")
" 2>/dev/null || {
    echo "スピーカー一覧取得失敗 — VOICEVOX が起動しているか確認してください"
    exit 1
  }
}

case "${1:-generate}" in
  speakers|list)
    check_voicevox
    list_speakers
    ;;
  *)
    check_voicevox
    generate_wav
    ;;
esac
