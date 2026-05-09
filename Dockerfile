FROM node:20-slim

# tzdata критичен: node-cron и Intl.DateTimeFormat в src/archive.ts требуют системную TZ-базу
# для корректного резолва "Europe/Moscow". На node:20-slim tzdata НЕ установлен.
# tar — для daily backup (src/backup.ts execFileSync("tar")). На node:20-slim
# обычно есть, но явно лучше — образ self-contained.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata tar \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Moscow
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV SEED_DIR=/app/seed

WORKDIR /app

# Слой кэшируется до изменения lock-файла → быстрый rebuild при правке кода
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

# Копируем ровно то, что нужно рантайму. channels.json/websites.json теперь
# хранятся в /app/seed/ как immutable defaults — на первом старте src/seed.ts
# (ensureSeedFiles) копирует их в /app/data/config/ если volume пуст.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY channels.json /app/seed/channels.json
COPY websites.json /app/seed/websites.json

# Каталоги для persistent volume. ensureSeedFiles() подстрахует на runtime,
# но и на build-time создаём — чтобы пустой volume на первом mount получил
# готовую структуру под config/state/raw/output/logs/backups.
RUN mkdir -p /app/data/config \
             /app/data/state \
             /app/data/raw \
             /app/data/output \
             /app/data/logs \
             /app/data/backups

# КРИТИЧНО: НЕ использовать --env-file=.env (как в npm start), потому что .env исключён из образа.
# Env переменные приходят из docker-compose env_file (локально) или Timeweb UI (прод).
CMD ["node", "--import", "tsx", "src/run.ts"]
