#!/usr/bin/env bash
# deploy.sh — pre-deploy snapshot + git pull + docker rebuild.
# Запускается:
#   - вручную: sudo bash /opt/tg-parser-demo/deploy.sh
#   - из CI:   GitHub Actions → ssh-action → bash /opt/tg-parser-demo/deploy.sh
# Идемпотентен: при отсутствии новых коммитов docker compose up --build
# пересоберёт образ только если изменились слои (см. кэш Dockerfile).
#
# ---- ONE-TIME MIGRATION (только при первом деплое после миграции на DATA_DIR) ----
# До первого запуска новой версии оператор должен переместить мутабельные файлы:
#   mkdir -p /opt/tg-parser-demo/data/{config,state,logs}
#   cp /opt/tg-parser-demo/channels.json /opt/tg-parser-demo/data/config/
#   cp /opt/tg-parser-demo/websites.json /opt/tg-parser-demo/data/config/
#   mv /opt/tg-parser-demo/data/hash-cache.json /opt/tg-parser-demo/data/state/ 2>/dev/null || true
#   mv /opt/tg-parser-demo/data/web-posts-*.json /opt/tg-parser-demo/data/state/ 2>/dev/null || true
#   mv /opt/tg-parser-demo/data/run-*.log /opt/tg-parser-demo/data/logs/ 2>/dev/null || true
# После этого первого деплоя seed-логика просто увидит существующие config/*.json
# и не перетрёт их дефолтами. Этот блок выполняется ОДИН РАЗ вручную, deploy.sh
# его НЕ выполняет (опасно автоматизировать).
# -------------------------------------------------------------------------------

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tg-parser-demo}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
RETAIN="${RETAIN:-5}"

cd "$APP_DIR"

# 1. Pre-deploy snapshot — мгновенный rollback при битом релизе.
#    Ловит config/ + state/, чтобы свежие channels (через бот) и hash-cache
#    (14 дней дедупа) не потерялись если новый релиз разломает что-то на старте.
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
SNAPSHOT="${BACKUP_DIR}/pre-deploy-${TS}.tgz"
echo "[deploy] snapshot: $SNAPSHOT"
# `|| true` — если data/config/ или data/state/ ещё не созданы (первый деплой),
# tar упадёт с exit=2; не блокируем deploy.
tar czf "$SNAPSHOT" -C "$APP_DIR" data/config data/state 2>/dev/null || \
  echo "[deploy] warn: snapshot empty (data/config or data/state not present yet)"

# 2. Pull последних изменений. fetch + reset --hard вместо pull --ff-only —
#    defensive против случайных правок на проде, которые блокируют FF-merge.
echo "[deploy] git fetch + reset --hard origin/main"
git fetch origin main
git reset --hard origin/main

# 3. Rebuild контейнера.
echo "[deploy] docker compose up -d --build --remove-orphans"
docker compose pull || true
docker compose build --pull
docker compose up -d --remove-orphans

# 4. Retain only N latest snapshots.
echo "[deploy] pruning snapshots, keeping $RETAIN latest"
ls -1t "$BACKUP_DIR"/pre-deploy-*.tgz 2>/dev/null | tail -n "+$((RETAIN+1))" | xargs -r rm

echo "[deploy] last 50 log lines:"
docker compose logs --tail 50
