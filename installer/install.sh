#!/usr/bin/env bash
# kancolle-notify Linux online installer.

set -e

REPO_SLUG="${REPO_SLUG:-Ikumyon/kancolle-notify}"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/share/kancolle-notify}"
MODE="${MODE:-Full}"

while [ $# -gt 0 ]; do
    case "$1" in
        --mode)
            shift
            MODE="${1:-$MODE}"
            ;;
        --test)
            MODE="Test"
            ;;
        *)
            break
            ;;
    esac
    shift
done

CF_API_TOKEN="${1:-${CF_API_TOKEN:-}}"
DISCORD_WEBHOOK="${2:-${DISCORD_WEBHOOK:-}}"
TEMP_DIR=$(mktemp -d -t kancolle-setup-XXXXXX)

cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

case "$MODE" in
    Full|Test) ;;
    *)
        echo "エラー: --mode は Full / Test のいずれかを指定してください。" >&2
        exit 1
        ;;
esac

INSTALLS_ASSETS=0
WRITES_CLOUDFLARE=0
WRITES_LOCAL_CONFIG=0

case "$MODE" in
    Full)
        INSTALLS_ASSETS=1
        WRITES_CLOUDFLARE=1
        WRITES_LOCAL_CONFIG=1
        ;;
    Test)
        INSTALLS_ASSETS=1
        WRITES_LOCAL_CONFIG=1
        ;;
esac

echo "=========================================================="
echo "      艦これ通知システム (kancolle-notify) インストーラー"
echo "=========================================================="
echo "Mode: ${MODE}"
echo ""

for cmd in curl tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "エラー: '$cmd' コマンドが必要です。" >&2
        exit 1
    fi
done

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

if [ "$INSTALLS_ASSETS" = "1" ]; then
    mkdir -p "${INSTALL_DIR}/desktop" "${INSTALL_DIR}/extension"

    echo "[1/5] GitHub (${REPO_SLUG}) から最新資材を取得中..."
    curl -fsSL "https://github.com/${REPO_SLUG}/archive/refs/heads/main.tar.gz" -o "${TEMP_DIR}/repo.tar.gz"
    mkdir -p "${TEMP_DIR}/repo_extracted"
    tar -xzf "${TEMP_DIR}/repo.tar.gz" -C "${TEMP_DIR}/repo_extracted"
    ROOT_FOLDER=$(find "${TEMP_DIR}/repo_extracted" -mindepth 1 -maxdepth 1 -type d | head -n 1)

    cp -r "${ROOT_FOLDER}/extension/"* "${INSTALL_DIR}/extension/" 2>/dev/null || true

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

    echo "[2/5] Linux 用デスクトップバイナリを取得中..."
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO_SLUG}/releases/latest" || true)
    PKG_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*linux-x64.tar.gz' | head -n 1 || true)
    DAEMON_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*kancolle-daemon[^"]*' | head -n 1 || true)
    GUI_URL=$(echo "${RELEASE_JSON}" | grep -o 'https://[^"]*kancolle-gui[^"]*' | head -n 1 || true)

    if [ -n "$PKG_URL" ]; then
        curl -fsSL "$PKG_URL" -o "${TEMP_DIR}/package.tar.gz"
        tar -xzf "${TEMP_DIR}/package.tar.gz" -C "${TEMP_DIR}"
        PKG_DIR=$(find "${TEMP_DIR}" -maxdepth 2 -type d -name "kancolle-notify" | head -n 1)
        if [ -n "$PKG_DIR" ]; then
            cp -r "${PKG_DIR}/"* "${INSTALL_DIR}/desktop/"
        fi
    else
        if [ -n "$DAEMON_URL" ]; then
            curl -fsSL "$DAEMON_URL" -o "${INSTALL_DIR}/desktop/kancolle-daemon"
            chmod +x "${INSTALL_DIR}/desktop/kancolle-daemon"
        fi
        if [ -n "$GUI_URL" ]; then
            curl -fsSL "$GUI_URL" -o "${INSTALL_DIR}/desktop/kancolle-gui"
            chmod +x "${INSTALL_DIR}/desktop/kancolle-gui"
        fi
    fi

    if [ ! -f "${INSTALL_DIR}/desktop/kancolle-gui" ]; then
        echo "エラー: kancolle-gui をダウンロードできませんでした。最新リリースの資産を確認してください。" >&2
        exit 1
    fi
    if [ ! -f "${INSTALL_DIR}/desktop/kancolle-daemon" ]; then
        echo "エラー: kancolle-daemon をダウンロードできませんでした。最新リリースの資産を確認してください。" >&2
        exit 1
    fi
fi

echo "[3/5] Cloudflare 確認・構築を実行中..."
VERIFY_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/user/tokens/verify")
if ! echo "${VERIFY_RES}" | grep -q '"status":"active"'; then
    echo "エラー: Cloudflare API トークンが無効です。" >&2
    exit 1
fi

ACCOUNTS_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts")
ACCOUNT_ID=$(echo "${ACCOUNTS_RES}" | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4)
if [ -z "$ACCOUNT_ID" ]; then
    echo "エラー: Cloudflare アカウントが見つかりませんでした。" >&2
    exit 1
fi

if [ "$MODE" = "Test" ]; then
    echo "  -> Test: D1 確認はスキップし、疑似D1を使用します。"
    DB_ID="test-d1-database-id"
else
    D1_LIST=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database?name=kancolle-notify")
    DB_ID=$(echo "${D1_LIST}" | grep -o '"uuid":"[^"]*' | head -n 1 | cut -d'"' -f4 || true)
fi

if [ -z "$DB_ID" ] && [ "$WRITES_CLOUDFLARE" = "1" ]; then
    D1_CREATE=$(curl -fsSL -X POST -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        -d '{"name":"kancolle-notify"}' \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database")
    DB_ID=$(echo "${D1_CREATE}" | grep -o '"uuid":"[^"]*' | head -n 1 | cut -d'"' -f4)
fi

if [ "$WRITES_CLOUDFLARE" = "1" ] && [ -f "$SCHEMA_FILE" ]; then
    ESCAPED_SQL=$(tr '\n' ' ' < "${SCHEMA_FILE}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    printf '{"sql":"%s"}' "${ESCAPED_SQL}" > "${TEMP_DIR}/schema.json"
    curl -fsSL -X POST -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        --data-binary "@${TEMP_DIR}/schema.json" \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query" >/dev/null
elif [ "$MODE" = "Test" ] && [ -f "$SCHEMA_FILE" ]; then
    SCHEMA_BYTES=$(wc -c < "$SCHEMA_FILE" | tr -d ' ')
    echo "  -> Test: D1 スキーマをローカル確認しました (${SCHEMA_BYTES} bytes)。適用はしません。"
fi

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

if [ "$WRITES_CLOUDFLARE" = "1" ]; then
    echo "$METADATA_JSON" > "${TEMP_DIR}/metadata.json"
    curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -F "metadata=@${TEMP_DIR}/metadata.json;type=application/json" \
        -F "bundled-worker.js=@${WORKER_FILE};type=application/javascript+module" \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify" >/dev/null
else
    echo "$METADATA_JSON" > "${TEMP_DIR}/metadata.json"
    if [ -f "$WORKER_FILE" ]; then
        WORKER_BYTES=$(wc -c < "$WORKER_FILE" | tr -d ' ')
    else
        WORKER_BYTES=0
    fi
    echo "  -> Test: Worker アップロード直前の内容を作成しました。アップロードはしません (${WORKER_BYTES} bytes)。"
fi

RAW_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
TOKEN_HASH=$(echo -n "$RAW_TOKEN" | sha256sum | awk '{print $1}')

if [ "$WRITES_CLOUDFLARE" = "1" ]; then
    curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
        -d "{\"name\":\"DEVICE_TOKENS\",\"text\":\"{\\\"linux\\\":\\\"${TOKEN_HASH}\\\"}\",\"type\":\"secret_text\"}" \
        "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify/secrets" >/dev/null

    if [ -n "$DISCORD_WEBHOOK" ]; then
        curl -fsSL -X PUT -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
            -d "{\"name\":\"DISCORD_WEBHOOK_URL\",\"text\":\"${DISCORD_WEBHOOK}\",\"type\":\"secret_text\"}" \
            "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/kancolle-notify/secrets" >/dev/null
    fi
else
    echo "  -> Test: DEVICE_TOKENS / Discord シークレット登録はスキップします。"
fi

if [ "$MODE" = "Test" ]; then
    WORKER_URL="https://kancolle-notify.test.local"
else
    SUBDOMAIN_RES=$(curl -fsSL -H "Authorization: Bearer ${CF_API_TOKEN}" "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain")
    SUBDOMAIN=$(echo "${SUBDOMAIN_RES}" | grep -o '"subdomain":"[^"]*' | head -n 1 | cut -d'"' -f4)
    WORKER_URL="https://kancolle-notify.${SUBDOMAIN}.workers.dev"
fi

if [ "$WRITES_LOCAL_CONFIG" = "1" ]; then
    echo "[4/5] デスクトップ初期設定ファイル (config.json) を生成中..."
    cat <<EOF > "${INSTALL_DIR}/desktop/config.json"
{
  "server_url": "${WORKER_URL}",
  "token": "${RAW_TOKEN}",
  "play_sound": true
}
EOF
fi

if [ "$INSTALLS_ASSETS" = "1" ]; then
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
Comment=艦これ通知システム管理
Exec="${INSTALL_DIR}/desktop/kancolle-gui"
Icon=${APP_ICON}
Terminal=false
Categories=Game;Utility;
EOF
    chmod +x "${HOME}/.local/share/applications/kancolle-gui.desktop"
fi

echo ""
echo "=========================================================="
echo "セットアップ処理が完了しました"
echo "Mode: ${MODE}"
echo "サーバーURL: ${WORKER_URL}"
echo "インストール先: ${INSTALL_DIR}/desktop"
echo "=========================================================="
