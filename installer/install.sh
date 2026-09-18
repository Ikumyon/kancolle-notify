#!/usr/bin/env bash
# ==============================================================================
# kancolle-notify - Linux用 オンラインインストーラー
# GitHub Releases から最新の Linux バイナリと拡張機能を自動ダウンロードし、
# Cloudflare Workers の全自動デプロイと初期設定を行います。
# ==============================================================================

set -e

REPO_SLUG="Ikumyon/kancolle-notify"
INSTALL_DIR="${INSTALL_DIR:-}"
TEMP_DIR=$(mktemp -d -t kancolle-setup-XXXXXX)

cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

echo "=========================================================="
echo "      艦これ通知システム (kancolle-notify) インストーラー"
echo "=========================================================="
echo ""

# 依存コマンドの確認
for cmd in curl tar python3; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "エラー: '$cmd' コマンドが必要です。パッケージマネージャからインストールしてください。" >&2
        exit 1
    fi
done

# 引数または対話形式でパラメータを取得
CF_API_TOKEN="${1:-$CF_API_TOKEN}"
DISCORD_WEBHOOK="${2:-$DISCORD_WEBHOOK}"

DEFAULT_INSTALL_DIR="${HOME}/.local/share/kancolle-notify"
if [ -z "$INSTALL_DIR" ]; then
    echo "インストール先ディレクトリ [デフォルト: ${DEFAULT_INSTALL_DIR}]:"
    read -r -p "> " USER_INPUT_DIR
    INSTALL_DIR="${USER_INPUT_DIR:-$DEFAULT_INSTALL_DIR}"
    echo ""
fi

if [ -z "$CF_API_TOKEN" ]; then
    echo "Cloudflare の API トークンを入力してください（Workers/D1 の編集権限が必要）:"
    read -r -p "> " CF_API_TOKEN
    echo ""
fi

if [ -z "$CF_API_TOKEN" ]; then
    echo "エラー: Cloudflare API トークンは必須です。" >&2
    exit 1
fi

if [ -z "$DISCORD_WEBHOOK" ]; then
    echo "Discord Webhook URL（通知先、空欄でスキップ可能）:"
    read -r -p "> " DISCORD_WEBHOOK
    echo ""
fi

mkdir -p "${INSTALL_DIR}/desktop"
mkdir -p "${INSTALL_DIR}/extension"

echo "[1/5] GitHub (${REPO_SLUG}) から最新資材を取得中..."

# 1. 拡張機能と Worker スクリプトの取得（最新 main.tar.gz）
echo "  -> ブラウザ拡張機能およびサーバー定義をダウンロード中..."
curl -fsSL "https://github.com/${REPO_SLUG}/archive/refs/heads/main.tar.gz" -o "${TEMP_DIR}/repo.tar.gz"
mkdir -p "${TEMP_DIR}/repo_extracted"
tar -xzf "${TEMP_DIR}/repo.tar.gz" -C "${TEMP_DIR}/repo_extracted"
ROOT_FOLDER=$(find "${TEMP_DIR}/repo_extracted" -mindepth 1 -maxdepth 1 -type d | head -n 1)

if [ -d "${ROOT_FOLDER}/extension" ]; then
    cp -r "${ROOT_FOLDER}/extension/"* "${INSTALL_DIR}/extension/"
fi

# デスクトップ資材（アイコン・音声・README）の配置
if [ -d "${ROOT_FOLDER}/desktop/icons" ]; then
    mkdir -p "${INSTALL_DIR}/desktop/icons"
    cp -r "${ROOT_FOLDER}/desktop/icons/"* "${INSTALL_DIR}/desktop/icons/"
fi

if [ -d "${ROOT_FOLDER}/desktop/sounds" ]; then
    mkdir -p "${INSTALL_DIR}/desktop/sounds"
    cp -r "${ROOT_FOLDER}/desktop/sounds/"* "${INSTALL_DIR}/desktop/sounds/"
fi

if [ -f "${ROOT_FOLDER}/desktop/README.md" ]; then
    cp "${ROOT_FOLDER}/desktop/README.md" "${INSTALL_DIR}/desktop/README.md"
fi

WORKER_FILE="${ROOT_FOLDER}/installer/bundled-worker.js"
SCHEMA_FILE="${ROOT_FOLDER}/server/schema.sql"

# 2. Linux 用最新バイナリのダウンロード
echo "[2/5] Linux 用デスクトップバイナリ（デーモン & GUI）を取得中..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" || curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases" | grep -m 1 -B 2 'tag_name' || true)

DAEMON_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*kancolle-daemon[^"]*' | head -n 1 || true)
GUI_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*kancolle-gui[^"]*' | head -n 1 || true)
PKG_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*linux-x64.tar.gz' | head -n 1 || true)

if [ -n "$PKG_URL" ]; then
    echo "  -> Linux 配布アーカイブをダウンロード中..."
    curl -fsSL "$PKG_URL" -o "${TEMP_DIR}/package.tar.gz"
    tar -xzf "${TEMP_DIR}/package.tar.gz" -C "${TEMP_DIR}"
    PKG_DIR=$(find "${TEMP_DIR}" -maxdepth 2 -type d -name "kancolle-notify" | head -n 1)
    if [ -n "$PKG_DIR" ]; then
        cp -r "${PKG_DIR}/"* "${INSTALL_DIR}/desktop/"
    fi
else
    if [ -n "$DAEMON_URL" ]; then
        echo "  -> kancolle-daemon をダウンロード中..."
        curl -fsSL "$DAEMON_URL" -o "${INSTALL_DIR}/desktop/kancolle-daemon"
        chmod +x "${INSTALL_DIR}/desktop/kancolle-daemon"
    fi
    if [ -n "$GUI_URL" ]; then
        echo "  -> kancolle-gui をダウンロード中..."
        curl -fsSL "$GUI_URL" -o "${INSTALL_DIR}/desktop/kancolle-gui"
        chmod +x "${INSTALL_DIR}/desktop/kancolle-gui"
    fi
fi


# 3. Cloudflare REST API 経由での全自動デプロイ
echo "[3/5] Cloudflare Workers を自動構築・デプロイ中..."

# トークン検証
VERIFY_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/user/tokens/verify")
if ! echo "${VERIFY_RES}" | grep -q '"status":"active"'; then
    echo "エラー: Cloudflare API トークンが無効です。" >&2
    exit 1
fi

# アカウントID取得
ACCOUNTS_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts")
ACCOUNT_ID=$(echo "${ACCOUNTS_RES}" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4)

if [ -z "$ACCOUNT_ID" ]; then
    echo "エラー: Cloudflare アカウントが見つかりませんでした。" >&2
    exit 1
fi
echo "  -> アカウントID: ${ACCOUNT_ID}"

# D1 データベース確認・作成
D1_LIST=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database?name=kancolle-notify")
DB_ID=$(echo "${D1_LIST}" | grep -o '"uuid":"[^"]*' | head -n 1 | cut -d'"' -f4 || true)

if [ -z "$DB_ID" ]; then
    echo "  -> D1 データベース (kancolle-notify) を新規作成中..."
    D1_CREATE=$(curl -fsSL -X POST -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        -d '{"name":"kancolle-notify"}' \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database")
    DB_ID=$(echo "${D1_CREATE}" | grep -o '"uuid":"[^"]*' | head -n 1 | cut -d'"' -f4)
else
    echo "  -> 既存の D1 データベースを使用: ${DB_ID}"
fi

# スキーマ適用
if [ -f "$SCHEMA_FILE" ]; then
    echo "  -> D1 スキーマを適用中..."
    SCHEMA_SQL=$(tr '\n' ' ' < "$SCHEMA_FILE")
    python3 -c "
import json, sys
sql = open('$SCHEMA_FILE').read()
data = json.dumps({'sql': sql})
print(data)
" > "${TEMP_DIR}/schema.json" 2>/dev/null || echo "{\"sql\": $(python3 -c "import json; print(json.dumps(open('$SCHEMA_FILE').read()))")}" > "${TEMP_DIR}/schema.json"

    curl -fsSL -X POST -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        --data-binary "@${TEMP_DIR}/schema.json" \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query" >/dev/null
fi

# Worker スクリプトのアップロード (Multipart)
echo "  -> Worker スクリプトをデプロイ中..."
METADATA_JSON=$(cat <<EOF
{
  "main_module": "bundled-worker.js",
  "compatibility_date": "2026-09-09",
  "bindings": [
    { "type": "d1", "name": "DB", "id": "${DB_ID}" },
    { "type": "durable_object_namespace", "name": "SCHEDULER", "class_name": "NotificationScheduler" }
  ],
  "migrations": {
    "new_tag": "scheduler-v1",
    "steps": [{ "new_sqlite_classes": ["NotificationScheduler"] }]
  }
}
EOF
)
echo "$METADATA_JSON" > "${TEMP_DIR}/metadata.json"

curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -F "metadata=@${TEMP_DIR}/metadata.json;type=application/json" \
    -F "bundled-worker.js=@${WORKER_FILE};type=application/javascript+module" \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify" >/dev/null

# 認証トークン生成
RAW_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
TOKEN_HASH=$(echo -n "$RAW_TOKEN" | sha256sum | awk '{print $1}')

echo "  -> デバイストークン シークレットを登録中..."
curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
    -d "{\"name\":\"DEVICE_TOKENS\",\"text\":\"{\\\"linux\\\":\\\"${TOKEN_HASH}\\\"}\",\"type\":\"secret_text\"}" \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify/secrets" >/dev/null

if [ -n "$DISCORD_WEBHOOK" ]; then
    echo "  -> Discord Webhook シークレットを登録中..."
    curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        -d "{\"name\":\"DISCORD_WEBHOOK_URL\",\"text\":\"${DISCORD_WEBHOOK}\",\"type\":\"secret_text\"}" \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify/secrets" >/dev/null
fi

# サブドメインの確認
SUBDOMAIN_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain")
SUBDOMAIN=$(echo "${SUBDOMAIN_RES}" | grep -o '"subdomain":"[^"]*' | head -n 1 | cut -d'"' -f4)
WORKER_URL="https://kancolle-notify.${SUBDOMAIN}.workers.dev"

# 4. config.json の生成
echo "[4/5] デスクトップ初期設定ファイル (config.json) を生成中..."
cat <<EOF > "${INSTALL_DIR}/desktop/config.json"
{
  "server_url": "${WORKER_URL}",
  "token": "${RAW_TOKEN}",
  "play_sound": true
}
EOF

# 5. Linux アプリケーションメニュー登録 (.desktop)
echo "[5/5] Linux デスクトップ環境へ登録中..."
mkdir -p "${HOME}/.local/share/applications"

APP_ICON="${INSTALL_DIR}/desktop/icons/app.png"
if [ ! -f "$APP_ICON" ]; then
    APP_ICON="${INSTALL_DIR}/desktop/icons/default.png"
fi

cat <<EOF > "${HOME}/.local/share/applications/kancolle-gui.desktop"
[Desktop Entry]
Type=Application
Name=艦これ 通知管理
Comment=艦これ通知システム管理ダッシュボード
Exec="${INSTALL_DIR}/desktop/kancolle-gui"
Icon=${APP_ICON}
Terminal=false
Categories=Game;Utility;
EOF
chmod +x "${HOME}/.local/share/applications/kancolle-gui.desktop"

echo ""
echo "=========================================================="
echo "              🎉 セットアップが完了しました！"
echo "=========================================================="
echo "・サーバーURL: ${WORKER_URL}"
echo "・インストール先: ${INSTALL_DIR}/desktop"
echo ""
echo "【次のステップ】"
echo "1. ブラウザ拡張機能の読み込み:"
echo "   Chrome/Edge で chrome://extensions を開き、デベロッパーモードをONにして"
echo "   'パッケージ化されていない拡張機能を読み込む' から以下を選択してください："
echo "   -> ${INSTALL_DIR}/extension"
echo ""
echo "2. 通知管理GUIの起動:"
echo "   アプリメニューから「艦これ 通知管理」を開くか、以下のコマンドを実行してください："
echo "   -> ${INSTALL_DIR}/desktop/kancolle-gui"
echo "=========================================================="
