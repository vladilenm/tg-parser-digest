#!/usr/bin/env bash
# bootstrap.sh — однократный onboarding tg-parser-demo на свежей Ubuntu 24.04 VDS.
# Usage:
#   scp bootstrap.sh root@<VDS_HOST>:/tmp/
#   ssh root@<VDS_HOST> "bash /tmp/bootstrap.sh"
# Идемпотентен: повторный запуск ничего не ломает.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vladilenm/tg-parser-digest.git}"

# ---------------------------------------------------------------------------
# 1. Установка Docker и Git
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "[bootstrap] Installing docker.io, docker-compose-plugin, git via apt..."
  apt-get update -qq
  apt-get install -y docker.io docker-compose-plugin git
  systemctl enable --now docker
  echo "[bootstrap] Docker installed and started."
else
  echo "[bootstrap] docker already installed, skipping apt"
  # Git may still be missing even if docker is present
  if ! command -v git >/dev/null 2>&1; then
    echo "[bootstrap] Installing git via apt..."
    apt-get update -qq
    apt-get install -y git
  fi
fi

# ---------------------------------------------------------------------------
# 2. Клонирование репо в /opt/tg-parser-demo
# ---------------------------------------------------------------------------
if [ -d /opt/tg-parser-demo/.git ]; then
  echo "[bootstrap] /opt/tg-parser-demo already cloned, skipping"
else
  echo "[bootstrap] Cloning ${REPO_URL} → /opt/tg-parser-demo ..."
  git clone "${REPO_URL}" /opt/tg-parser-demo
  echo "[bootstrap] Clone complete."
fi

# ---------------------------------------------------------------------------
# 3. Создание .env-шаблона (только если файла нет)
# ---------------------------------------------------------------------------
if [ ! -f /opt/tg-parser-demo/.env ]; then
  echo "[bootstrap] Writing /opt/tg-parser-demo/.env template..."
  cat > /opt/tg-parser-demo/.env <<'EOF'
# =============================================================================
# tg-parser-demo — заполни реальными значениями.
# ВНИМАНИЕ: держи файл в тайне, не публикуй секреты.
# =============================================================================

# --- Telegram user-session (чтение каналов через GramJS / MTProto) ----------
# https://my.telegram.org → API development tools → App api_id
TG_API_ID=
# https://my.telegram.org → API development tools → App api_hash
TG_API_HASH=
# StringSession: сгенерируй локально через `npm run login`, скопируй сюда
TG_SESSION=

# --- Telegram bot (доставка дайджеста в приватный канал) --------------------
# @BotFather → /newbot → скопировать токен
TG_BOT_TOKEN=
# -100xxxxxxxxxx (приватный канал, бот — admin). Получить через @username_to_id_bot
TG_CHANNEL_ID=

# --- DeepSeek (LLM-суммаризация) --------------------------------------------
# https://platform.deepseek.com → API keys
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

# --- Параметры прогона (опциональные, дефолты работают) ---------------------
FETCH_WINDOW_HOURS=24
MAX_MESSAGES_PER_CHANNEL=50
CHANNEL_DELAY_MS=1500
LOG_LEVEL=info

# --- Alert-bot (технические ошибки pipeline) --------------------------------
# @BotFather → /newbot (отдельный от TG_BOT_TOKEN)
BOT_TOKEN_ALERTS=
# Numeric chat_id личного чата владельца с alert-ботом
ALERTS_CHAT_ID=
EOF
  chmod 600 /opt/tg-parser-demo/.env
  echo "[bootstrap] .env template written and permissions set to 600."
else
  echo "[bootstrap] /opt/tg-parser-demo/.env already exists, NOT overwriting"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "[bootstrap] Done. Next steps:"
echo "  1) Edit /opt/tg-parser-demo/.env (fill empty TG_*, DEEPSEEK_*, ALERTS_*)"
echo "  2) Run: sudo bash /opt/tg-parser-demo/deploy.sh"
