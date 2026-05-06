#!/bin/bash
# Phase 1: システム準備 + NVIDIA ドライバインストール
#
# 実行方法:
#   source /etc/seaman-env && bash /usr/local/bin/setup-phase1.sh
#
# 完了後、手動で reboot してから setup-phase2.sh を実行すること。

set -euo pipefail

LOG=/var/log/seaman-setup.log
exec > >(tee -a "$LOG") 2>&1

source /etc/seaman-env

log() { echo "[setup-phase1] $(date '+%H:%M:%S') $*"; }

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
  log "NVIDIA ドライバインストール完了"
fi

log "Phase 1 完了 — 手動で reboot 後に setup-phase2.sh を実行してください"
