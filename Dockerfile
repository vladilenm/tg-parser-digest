FROM node:20-slim

# tzdata критичен: node-cron и Intl.DateTimeFormat в src/archive.ts требуют системную TZ-базу
# для корректного резолва "Europe/Moscow". На node:20-slim tzdata НЕ установлен.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Europe/Moscow
ENV NODE_ENV=production

WORKDIR /app

# Слой кэшируется до изменения lock-файла → быстрый rebuild при правке кода
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

# Копируем ровно то, что нужно рантайму. channels.yaml — дефолт-список;
# при необходимости оператор может прокинуть prod-channels.yaml через bind mount на Timeweb.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY channels.yaml ./

# Каталог для архивов прогонов (data/raw, data/output, data/dedup-cache).
# На Timeweb сюда подключается persistent volume через UI; локально — bind mount из docker-compose.
RUN mkdir -p /app/data

# КРИТИЧНО: НЕ использовать --env-file=.env (как в npm start), потому что .env исключён из образа.
# Env переменные приходят из docker-compose env_file (локально) или Timeweb UI (прод).
CMD ["node", "--import", "tsx", "src/run.ts"]
