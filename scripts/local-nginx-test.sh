#!/usr/bin/env bash
# scripts/local-nginx-test.sh
# macOS ローカル疎通テスト用スクリプト
# - mkcert で seaman.local の自己署名証明書を生成
# - nginx/.local/ に作業ファイルを集約（.gitignore 対象）
# - ポート 8443 / 8080（sudo 不要）
# - Apple Silicon / Intel 両対応

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_DIR="$PROJECT_ROOT/nginx/.local"
TEMPLATE="$PROJECT_ROOT/nginx/seaman.conf"

DOMAIN="seaman.local"
HTTPS_PORT=8443
HTTP_PORT=8080
HTPASSWD_USER="seaman"
HTPASSWD_PASS="seaman"

# Homebrew プレフィックス（Apple Silicon / Intel 両対応）
if [[ -d /opt/homebrew ]]; then
    BREW_PREFIX="/opt/homebrew"
else
    BREW_PREFIX="/usr/local"
fi

NGINX_BIN="$BREW_PREFIX/bin/nginx"
MIME_TYPES="$BREW_PREFIX/etc/nginx/mime.types"

# ── ツール確認 ──────────────────────────────────────────────────────────────
check_tool() {
    if ! command -v "$1" &>/dev/null; then
        echo "ERROR: $1 が見つかりません。インストールしてください: $2"
        exit 1
    fi
}
check_tool mkcert  "brew install mkcert"
check_tool nginx   "brew install nginx"
check_tool htpasswd "xcode-select --install"

# ── ディレクトリ作成 ────────────────────────────────────────────────────────
mkdir -p "$LOCAL_DIR/logs" "$LOCAL_DIR/certs"

# ── /etc/hosts 確認 ─────────────────────────────────────────────────────────
if ! grep -qE "^\s*127\.0\.0\.1\s+$DOMAIN" /etc/hosts; then
    echo ""
    echo "  /etc/hosts に $DOMAIN が登録されていません。"
    echo "  次のコマンドを実行してください（要 sudo）:"
    echo ""
    echo "    echo '127.0.0.1  $DOMAIN' | sudo tee -a /etc/hosts"
    echo ""
    echo "  登録後、このスクリプトを再実行してください。"
    exit 1
fi

# ── mkcert CA インストール & 証明書生成 ──────────────────────────────────────
mkcert -install 2>/dev/null || true

CERT="$LOCAL_DIR/certs/$DOMAIN.pem"
KEY="$LOCAL_DIR/certs/$DOMAIN-key.pem"

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
    echo ">> mkcert で証明書を生成します..."
    mkcert -cert-file "$CERT" -key-file "$KEY" "$DOMAIN"
fi

# ── htpasswd 生成 ────────────────────────────────────────────────────────────
HTPASSWD_FILE="$LOCAL_DIR/seaman.htpasswd"
if [[ ! -f "$HTPASSWD_FILE" ]]; then
    echo ">> htpasswd ファイルを生成します..."
    htpasswd -bc "$HTPASSWD_FILE" "$HTPASSWD_USER" "$HTPASSWD_PASS"
fi

# ── nginx.conf 生成（テンプレートから sed 置換）─────────────────────────────
LOCAL_CONF="$LOCAL_DIR/nginx.conf"

cat > "$LOCAL_CONF" <<NGINX_EOF
worker_processes 1;
pid              $LOCAL_DIR/nginx.pid;
error_log        $LOCAL_DIR/logs/error.log  warn;

events {
    worker_connections 1024;
}

http {
    include      $MIME_TYPES;
    default_type application/octet-stream;
    sendfile     on;

    access_log $LOCAL_DIR/logs/access.log combined;

    server {
        listen $HTTP_PORT;
        server_name $DOMAIN;
        return 301 https://\$host:$HTTPS_PORT\$request_uri;
    }

    server {
        listen $HTTPS_PORT ssl;
        http2  on;
        server_name $DOMAIN;

        ssl_certificate     $CERT;
        ssl_certificate_key $KEY;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers on;

        root  $PROJECT_ROOT;
        index index.html;

        auth_basic           "Demo Access";
        auth_basic_user_file $HTPASSWD_FILE;

        add_header Cross-Origin-Opener-Policy   "same-origin"    always;
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        add_header Cross-Origin-Resource-Policy "cross-origin"   always;

        location ~* \.(wasm|bin|onnx|glb)$ {
            expires    1y;
            add_header Cache-Control                "public, immutable";
            add_header Cross-Origin-Opener-Policy   "same-origin"    always;
            add_header Cross-Origin-Embedder-Policy "credentialless" always;
            add_header Cross-Origin-Resource-Policy "cross-origin"   always;
        }

        location ~* \.(html|js)$ {
            add_header Cache-Control                "no-cache";
            add_header Cross-Origin-Opener-Policy   "same-origin"    always;
            add_header Cross-Origin-Embedder-Policy "credentialless" always;
            add_header Cross-Origin-Resource-Policy "cross-origin"   always;
        }

        # Ollama リバースプロキシ（要: ollama serve 起動済み）
        location /api/ {
            proxy_pass         http://127.0.0.1:11434/api/;
            proxy_http_version 1.1;
            proxy_set_header   Host              \$host;
            proxy_set_header   X-Real-IP         \$remote_addr;
            proxy_buffering    off;
            proxy_read_timeout 300s;
            proxy_send_timeout 300s;
        }

        # VOICEVOX リバースプロキシ（要: VOICEVOX 起動済み）
        location /voicevox/ {
            rewrite            ^/voicevox/(.*)$ /\$1 break;
            proxy_pass         http://127.0.0.1:50021;
            proxy_http_version 1.1;
            proxy_set_header   Host \$host;
            client_max_body_size 1m;
        }

        location / {
            try_files \$uri \$uri/ /index.html;
        }
    }
}
NGINX_EOF

# ── 設定ファイル検証 ─────────────────────────────────────────────────────────
echo ""
echo ">> nginx -t で設定を検証します..."
"$NGINX_BIN" -c "$LOCAL_CONF" -t

# ── 案内メッセージ ────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  セットアップ完了"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  [起動]"
echo "    $NGINX_BIN -c $LOCAL_CONF"
echo ""
echo "  [停止]"
echo "    $NGINX_BIN -c $LOCAL_CONF -s stop"
echo ""
echo "  [設定リロード]"
echo "    $NGINX_BIN -c $LOCAL_CONF -s reload"
echo ""
echo "  [アクセス URL]"
echo "    https://$DOMAIN:$HTTPS_PORT/"
echo "    user: $HTPASSWD_USER  pass: $HTPASSWD_PASS"
echo ""
echo "  [COOP/COEP ヘッダ確認]"
echo "    curl -I -u $HTPASSWD_USER:$HTPASSWD_PASS https://$DOMAIN:$HTTPS_PORT/"
echo ""
echo "  [Ollama プロキシ確認]  ※ ollama serve 起動後"
echo "    curl -u $HTPASSWD_USER:$HTPASSWD_PASS https://$DOMAIN:$HTTPS_PORT/api/version"
echo ""
echo "  [VOICEVOX プロキシ確認]  ※ VOICEVOX 起動後"
echo "    curl -u $HTPASSWD_USER:$HTPASSWD_PASS https://$DOMAIN:$HTTPS_PORT/voicevox/version"
echo ""
echo "  [エラーログ]"
echo "    tail -f $LOCAL_DIR/logs/error.log"
echo ""
echo "  [アクセスログ]"
echo "    tail -f $LOCAL_DIR/logs/access.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
