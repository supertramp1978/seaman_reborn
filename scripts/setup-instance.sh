#!/bin/bash
# EC2 ブートストラップスクリプト
# CloudFormation UserData から呼ばれる。SEAMAN_SETUP_PHASE=1 で Phase 1 実行、
# 再起動後に systemd が SEAMAN_SETUP_PHASE=2 で Phase 2 を実行する。
#
# 必要な環境変数 (/etc/seaman-env から読み込む):
#   SEAMAN_DOMAIN            例: seaman.example.com
#   SEAMAN_CERTBOT_EMAIL     Let's Encrypt 登録メール
#   SEAMAN_GIT_REPO          git@github.com:USER/seaman-reborn.git
#   SEAMAN_SSM_DEPLOY_KEY    SSM Parameter名 /seaman/deploy-key
#   SEAMAN_SSM_HTPASSWD      SSM Parameter名 /seaman/htpasswd
#   SEAMAN_ASSET_BUCKET      S3 バケット名
#   SEAMAN_REGION            ap-northeast-1
#   SEAMAN_INSTANCE_ID       i-xxxx

set -euo pipefail

LOG=/var/log/seaman-setup.log
exec > >(tee -a "$LOG") 2>&1

source /etc/seaman-env

PHASE=${SEAMAN_SETUP_PHASE:-1}
WEBROOT=/opt/seaman-modern
VOICEVOX_VERSION="0.21.0"
VOICEVOX_DIR=/opt/voicevox

log() { echo "[seaman-setup Phase${PHASE}] $(date '+%H:%M:%S') $*"; }

# ─── Phase 1: システム準備 + NVIDIA ドライバ ─────────────────────────
phase1() {
  log "Phase 1 開始"

  # タイムゾーン
  timedatectl set-timezone Asia/Tokyo

  # システム更新
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold"

  # 基本ツール
  apt-get install -y --no-install-recommends \
    curl git wget jq htop \
    build-essential cmake python3 \
    nginx certbot python3-certbot-nginx \
    apache2-utils p7zip-full

  # 8GB スワップ (OOM 対策)
  if [ ! -f /swapfile ]; then
    fallocate -l 8G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "スワップ 8GB 作成完了"
  fi

  # NVIDIA ドライバ 535 (Ubuntu 22.04 + g5.xlarge)
  if ! dpkg -l | grep -q nvidia-driver-535; then
    add-apt-repository -y ppa:graphics-drivers/ppa
    apt-get update -qq
    apt-get install -y --no-install-recommends \
      nvidia-driver-535 nvidia-cuda-toolkit
    log "NVIDIA ドライバインストール完了 — 再起動が必要"
  fi

  # Phase 2 用 systemd サービスを作成
  cat > /etc/systemd/system/seaman-setup-p2.service <<'SERVICE'
[Unit]
Description=Seaman Phase 2 Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=!/var/lib/seaman-setup-done

[Service]
Type=oneshot
EnvironmentFile=/etc/seaman-env
Environment=SEAMAN_SETUP_PHASE=2
ExecStart=/usr/local/bin/seaman-setup.sh
RemainAfterExit=yes
StandardOutput=append:/var/log/seaman-setup.log
StandardError=append:/var/log/seaman-setup.log
TimeoutStartSec=3600

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable seaman-setup-p2.service

  log "Phase 1 完了 — 30 秒後に再起動します"
  sleep 30
  reboot
}

# ─── Phase 2: アプリケーション + 設定 ──────────────────────────────
phase2() {
  log "Phase 2 開始"

  # NVIDIA 確認
  nvidia-smi && log "GPU 認識 OK" || log "WARNING: nvidia-smi 失敗"

  # Ollama インストール
  if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    log "Ollama インストール完了"
  fi

  # Ollama: localhost のみリッスン
  mkdir -p /etc/systemd/system/ollama.service.d
  cat > /etc/systemd/system/ollama.service.d/override.conf <<'CONF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
CONF
  systemctl daemon-reload
  systemctl enable --now ollama
  log "Ollama 起動完了"

  # ELYZA モデル取得 (バックグラウンド)
  ollama pull dsasai/llama3-elyza-jp-8b:latest &
  log "ELYZA モデル pull 開始 (バックグラウンド)"

  # VOICEVOX Engine (GPU 版)
  install_voicevox

  # Nginx 設定
  setup_nginx

  # ソースコード取得
  clone_repo

  # whisper.cpp WASM ビルド
  if [ ! -f "$WEBROOT/assets/wasm/whisper/libmain.js" ]; then
    bash /usr/local/bin/build-whisper-wasm.sh "$WEBROOT"
  fi

  # TLS 証明書取得
  setup_tls

  # Basic 認証
  setup_basic_auth

  # Nginx 再起動
  nginx -t && systemctl restart nginx

  # ヘルスチェック + EC2 タグ更新
  health_check

  touch /var/lib/seaman-setup-done
  log "Phase 2 完了 ✓"
}

# ─── VOICEVOX インストール ───────────────────────────────────────────
install_voicevox() {
  if [ -d "$VOICEVOX_DIR" ]; then
    log "VOICEVOX: 既インストール済み — スキップ"
    return
  fi

  log "VOICEVOX ${VOICEVOX_VERSION} ダウンロード開始"
  BASE_URL="https://github.com/VOICEVOX/voicevox_engine/releases/download/${VOICEVOX_VERSION}"
  ARCHIVE_PREFIX="voicevox_engine-linux-nvidia-${VOICEVOX_VERSION}.7z"

  mkdir -p /tmp/voicevox-dl
  # 分割アーカイブをダウンロード (通常 .001〜.004)
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

  # 起動待ち
  for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:50021/speakers &>/dev/null && log "VOICEVOX 応答 OK" && return
    sleep 5
  done
  log "WARNING: VOICEVOX 起動タイムアウト"
}

# ─── Nginx 設定 ────────────────────────────────────────────────────
setup_nginx() {
  # S3 から seaman.conf を取得してプレースホルダを置換
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

# ─── Git clone ──────────────────────────────────────────────────────
clone_repo() {
  # SSH デプロイキーを SSM から取得
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

# ─── TLS (Let's Encrypt) ────────────────────────────────────────────
setup_tls() {
  if [ -f "/etc/letsencrypt/live/${SEAMAN_DOMAIN}/fullchain.pem" ]; then
    log "TLS 証明書: 既取得済み — スキップ"
    return
  fi

  # まず HTTP のみで Nginx を起動 (certbot の ACME チャレンジ用)
  # seaman.conf の 80 ブロックが動いていれば OK
  systemctl start nginx || true

  certbot --nginx \
    -d "$SEAMAN_DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$SEAMAN_CERTBOT_EMAIL" \
    --redirect

  log "TLS 証明書取得完了"
}

# ─── Basic 認証 ─────────────────────────────────────────────────────
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

# ─── ヘルスチェック ──────────────────────────────────────────────────
health_check() {
  PASS=true

  systemctl is-active --quiet ollama  && log "ollama: active"  || { log "ERROR: ollama 停止"; PASS=false; }
  systemctl is-active --quiet voicevox && log "voicevox: active" || { log "ERROR: voicevox 停止"; PASS=false; }
  systemctl is-active --quiet nginx   && log "nginx: active"   || { log "ERROR: nginx 停止"; PASS=false; }

  # EC2 タグ更新
  STATUS=$( [ "$PASS" = "true" ] && echo "Ready" || echo "SetupFailed" )
  aws ec2 create-tags \
    --resources "$SEAMAN_INSTANCE_ID" \
    --tags "Key=Status,Value=${STATUS}" \
    --region "$SEAMAN_REGION" || true

  log "ヘルスチェック完了: $STATUS"
}

# ─── エントリポイント ───────────────────────────────────────────────
case "$PHASE" in
  1) phase1 ;;
  2) phase2 ;;
  *) log "ERROR: SEAMAN_SETUP_PHASE=$PHASE は不正" ; exit 1 ;;
esac
