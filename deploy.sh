#!/usr/bin/env bash
# deploy.sh — pull последних изменений + пересборка docker-контейнера.
# Запускается:
#   - вручную: sudo bash /opt/tg-parser-demo/deploy.sh
#   - из CI:   GitHub Actions → ssh-action → bash /opt/tg-parser-demo/deploy.sh
# Идемпотентен: при отсутствии новых коммитов docker compose up --build
# пересоберёт образ только если изменились слои (см. кэш Dockerfile).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tg-parser-demo}"
cd "$APP_DIR"

echo "[deploy] git pull --ff-only origin main"
git pull --ff-only origin main

echo "[deploy] docker compose up -d --build"
docker compose up -d --build

echo "[deploy] last 50 log lines:"
docker compose logs --tail 50
