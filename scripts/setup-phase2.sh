#!/bin/bash
# Phase 2: アプリケーションセットアップ
#
# 実行方法 (reboot 後):
#   source /etc/seaman-env && bash /usr/local/bin/setup-phase2.sh
#
# 必要な環境変数 (/etc/seaman-env に記載済み):
#   SEAMAN_DOMAIN, SEAMAN_CERTBOT_EMAIL, SEAMAN_GIT_REPO,
#   SEAMAN_SSM_DEPLOY_KEY, SEAMAN_SSM_HTPASSWD,
#   SEAMAN_ASSET_BUCKET, SEAMAN_REGION, SEAMAN_INSTANCE_ID

set -euo pipefail

LOG=/var/log/seaman-setup.log
exec > >(tee -a "$LOG") 2>&1

source /etc/seaman-env

WEBROOT=/opt/seaman-modern
VOICEVOX_VERSION="0.21.0"
VOICEVOX_DIR=/opt/voicevox

log() { echo "[setup-phase2] $(date '+%H:%M:%S') $*"; }

# ─── Ollama ────────────────────────────────────────────────────────────
install_ollama() {
  nvidia-smi && log "GPU 認識 OK" || log "WARNING: nvidia-smi 失敗"

  if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    log "Ollama インストール完了"
  fi

  mkdir -p /etc/systemd/system/ollama.service.d
  cat > /etc/systemd/system/ollama.service.d/override.conf <<'CONF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
CONF

  systemctl daemon-reload
  systemctl enable --now ollama
  log "Ollama 起動完了"

  ollama pull dsasai/llama3-elyza-jp-8b:latest &
  log "ELYZA モデル pull 開始 (バックグラウンド)"
}

# ─── VOICEVOX ──────────────────────────────────────────────────────────
install_voicevox() {
  if [ -d "$VOICEVOX_DIR" ]; then
    log "VOICEVOX: 既インストール済み — スキップ"
    return
  fi

  log "VOICEVOX ${VOICEVOX_VERSION} ダウンロード開始"
  BASE_URL="https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}"
  ARCHIVE_PREFIX="voicevox_engine-linux-nvidia-${VOICEVOX_VERSION}.7z"

  mkdir -p /tmp/voicevox-dl
  for i in 001 002 003 004; do
    FILE="${ARCHIVE_PREFIX}.${i}"
    URL="${BASE_URL}/${FILE}"
    if curl -fsSL --head "$URL" &>/dev/null; then
      wget -q -O "/tmp/voicevox-dl/${FILE}" "$URL"
    fi
  done

  mkdir -p "$VOICEVOX_DIR"
  7z x "/tmp/voicevox-dl/${ARCHIVE_PREFIX}.001" -o"$VOICEVOX_DIR" -y
  rm -rf /tmp/voicevox-dl
  chmod +x "$VOICEVOX_DIR/run"
  log "VOICEVOX 展開完了"

  cat > /etc/systemd/system/voicevox.service <<SERVICE
[Unit]
Description=VOICEVOX Engine
After=network.target

[Service]
Type=simple
ExecStart=${VOICEVOX_DIR}/run --host 127.0.0.1 --port 50021 --use_gpu
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable --now voicevox
  log "VOICEVOX 起動完了"

  for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:50021/speakers &>/dev/null && log "VOICEVOX 応答 OK" && return
    sleep 5
  done
  log "WARNING: VOICEVOX 起動タイムアウト"
}

# ─── Nginx ─────────────────────────────────────────────────────────────
setup_nginx() {
  aws s3 cp "s3://${SEAMAN_ASSET_BUCKET}/nginx/seaman.conf" \
    /etc/nginx/sites-available/seaman \
    --region "$SEAMAN_REGION"

  sed -i \
    -e "s|__DOMAIN__|${SEAMAN_DOMAIN}|g" \
    -e "s|__WEBROOT__|${WEBROOT}|g" \
    /etc/nginx/sites-available/seaman

  ln -sf /etc/nginx/sites-available/seaman /etc/nginx/sites-enabled/seaman
  rm -f /etc/nginx/sites-enabled/default

  nginx -t && log "Nginx 設定 OK"
}

# ─── Git clone ─────────────────────────────────────────────────────────
clone_repo() {
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  aws ssm get-parameter \
    --name "$SEAMAN_SSM_DEPLOY_KEY" \
    --with-decryption \
    --query Parameter.Value \
    --output text \
    --region "$SEAMAN_REGION" > /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519

  ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null

  if [ ! -d "${WEBROOT}/.git" ]; then
    git clone "$SEAMAN_GIT_REPO" "$WEBROOT"
    log "git clone 完了"
  else
    git -C "$WEBROOT" pull
    log "git pull 完了"
  fi

  chown -R www-data:www-data "$WEBROOT"
}

# ─── TLS (Let's Encrypt) ───────────────────────────────────────────────
setup_tls() {
  if [ -f "/etc/letsencrypt/live/${SEAMAN_DOMAIN}/fullchain.pem" ]; then
    log "TLS 証明書: 既取得済み — スキップ"
    return
  fi

  systemctl start nginx || true

  certbot --nginx \
    -d "$SEAMAN_DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$SEAMAN_CERTBOT_EMAIL" \
    --redirect

  log "TLS 証明書取得完了"
}

# ─── Basic 認証 ────────────────────────────────────────────────────────
setup_basic_auth() {
  aws ssm get-parameter \
    --name "$SEAMAN_SSM_HTPASSWD" \
    --with-decryption \
    --query Parameter.Value \
    --output text \
    --region "$SEAMAN_REGION" > /etc/nginx/seaman.htpasswd
  chmod 640 /etc/nginx/seaman.htpasswd
  chgrp www-data /etc/nginx/seaman.htpasswd
  log "Basic 認証ファイル配置完了"
}

# ─── ヘルスチェック ────────────────────────────────────────────────────
health_check() {
  PASS=true

  systemctl is-active --quiet ollama   && log "ollama: active"   || { log "ERROR: ollama 停止";   PASS=false; }
  systemctl is-active --quiet voicevox && log "voicevox: active" || { log "ERROR: voicevox 停止"; PASS=false; }
  systemctl is-active --quiet nginx    && log "nginx: active"    || { log "ERROR: nginx 停止";    PASS=false; }

  STATUS=$( [ "$PASS" = "true" ] && echo "Ready" || echo "SetupFailed" )
  aws ec2 create-tags \
    --resources "$SEAMAN_INSTANCE_ID" \
    --tags "Key=Status,Value=${STATUS}" \
    --region "$SEAMAN_REGION" || true

  log "ヘルスチェック完了: $STATUS"
}

# ─── メイン ────────────────────────────────────────────────────────────
log "Phase 2 開始"

install_ollama
install_voicevox
setup_nginx
clone_repo

if [ ! -f "$WEBROOT/assets/wasm/whisper/libmain.js" ]; then
  bash /usr/local/bin/build-whisper-wasm.sh "$WEBROOT"
fi

setup_tls
setup_basic_auth

nginx -t && systemctl restart nginx

health_check

touch /var/lib/seaman-setup-done
log "Phase 2 完了 ✓"
