# spec-app.md — MVP parser (ручной запуск)

> Упрощённая версия проекта: один Node.js-скрипт, дёргается руками, читает 10–15 Telegram-каналов за последние 24 часа, прогоняет через DeepSeek, отправляет HTML-дайджест в закрытый Telegram-канал. Без БД, без Docker, без Redis, без крона.

---

## 1. Контекст и цель

**Что делаем:**
- Один исполняемый скрипт `src/run.ts`. Запускается командой `npm start`.
- Читает Telegram-каналы из `channels.yaml` (10–15 штук) за окно в 24 часа.
- Отдаёт все собранные посты одним батчем в DeepSeek (`deepseek-chat`) и получает готовый HTML-дайджест (экстрактивно, без галлюцинаций).
- Отправляет дайджест в закрытый канал через Telegram Bot API обычным `fetch`.
- Завершает процесс. Следующий запуск — снова руками.

**Чего не делаем:**
- Не храним состояние между запусками. Повторное появление одних и тех же постов в дайджестах допустимо.
- Не держим БД, очередей, Redis, Docker.
- Не запускаем cron — когда понадобится, обернём тот же скрипт в systemd-таймер или GitHub Actions.
- Не пишем собственного бота-слушателя — бот нужен только для отправки в канал.

---

## 2. Поток данных

```
channels.yaml ──► GramJS (user-session) ──► массив постов за 24ч
                                                    │
                                                    ▼
                                     DeepSeek chat.completions
                                     (response_format: json_object)
                                                    │
                                                    ▼
                                         HTML-дайджест (строка)
                                                    │
                                                    ▼
                         fetch https://api.telegram.org/bot<TOKEN>/sendMessage
                                                    │
                                                    ▼
                                           Закрытый Telegram-канал
```

Никакой магии между шагами — просто `await` внутри одной функции `main()`.

---

## 3. Стек

| Компонент | Решение | Пакет |
|---|---|---|
| Runtime | Node.js 20+, ESM | — |
| Язык | TypeScript без шага сборки | `tsx`, `typescript`, `@types/node` (dev) |
| Чтение Telegram | GramJS user-session (MTProto) | `telegram` |
| LLM | DeepSeek через OpenAI-совместимый SDK | `openai` |
| Отправка в канал | Telegram Bot API через встроенный `fetch` | — |
| Конфиг каналов | YAML | `yaml` |
| Секреты | `.env` | `node --env-file=.env` (Node 20.6+) |

Runtime-зависимости: **`telegram`**, **`openai`**, **`yaml`**. Всё.

---

## 4. Структура проекта

```
./
├── package.json             # "type": "module", scripts: login, start
├── tsconfig.json            # strict, ESNext, moduleResolution: bundler
├── .env.example
├── channels.yaml            # список username каналов
├── README.md                # запуск в 3 команды
├── scripts/
│   └── login.ts             # разовая генерация TG_SESSION
└── src/
    ├── run.ts               # entrypoint: fetch → summarize → deliver
    ├── telegram.ts          # GramJS client + fetchLast24h(channel)
    ├── summarize.ts         # вызов DeepSeek, возвращает HTML
    └── deliver.ts           # sendToChannel(html) через Bot API fetch
```

---

## 5. Переменные окружения (`.env.example`)

```bash
# Telegram user-session (для чтения каналов через GramJS)
TG_API_ID=                      # https://my.telegram.org → API development tools
TG_API_HASH=
TG_SESSION=                     # StringSession, сгенерируется через `npm run login`

# Telegram bot (для отправки дайджеста)
TG_BOT_TOKEN=                   # @BotFather
TG_CHANNEL_ID=                  # -100xxxxxxxxxx (приватный канал, бот — admin)

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com

# Параметры прогона
FETCH_WINDOW_HOURS=24
MAX_MESSAGES_PER_CHANNEL=50
CHANNEL_DELAY_MS=1000           # базовая задержка между каналами; к ней добавляется jitter
LOG_LEVEL=info
```

---

## 6. `channels.yaml` — формат

Только публичные каналы по `username`. User-аккаунт, чья сессия лежит в `TG_SESSION`, обязан быть подписан на каждый из них (иначе GramJS может бросить `ChannelPrivateError`). Приватные каналы в MVP не поддерживаются.

```yaml
channels:
  - username: "neftegazru"
    priority: 1
  - username: "oilfornication"
    priority: 2
  # ... всего 10–15 штук
```

Поле `priority` пока не используется — зарезервировано для будущей фильтрации/сортировки.

---

## 7. Шаги реализации

Последовательные, без параллелизма. После каждого — прогон руками.

### 7.1 `package.json` + `tsconfig.json`

```json
{
  "name": "tg-parser-demo",
  "type": "module",
  "scripts": {
    "login": "tsx scripts/login.ts",
    "start": "node --env-file=.env --import tsx src/run.ts"
  },
  "dependencies": {
    "openai": "^4.0.0",
    "telegram": "^2.22.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

### 7.2 `scripts/login.ts` — разовая генерация StringSession

Использует `TelegramClient` + `StringSession("")`, вызывает `client.start({ phoneNumber, phoneCode, password })` с интерактивным вводом через `readline`. На выходе печатает `client.session.save()` — пользователь копирует значение в `.env` как `TG_SESSION`. После этого скрипт завершает процесс.

### 7.3 `src/telegram.ts` — чтение последних 24 часов

Ключевые моменты:

- `createClient()` собирает `TelegramClient` с `StringSession(TG_SESSION)`, устанавливает `deviceModel`, `systemVersion`, `appVersion`, `langCode: "ru"` — чтобы сессия выглядела как обычный клиент, а не дефолтный GramJS.
- `fetchLast24h(client, username, { limit, windowHours })`:
  - вычисляет `sinceUnix = Math.floor(Date.now() / 1000) - windowHours * 3600`;
  - итерирует `client.iterMessages(username, { limit, offsetDate: 0, reverse: false })` — новые сверху;
  - останавливает итерацию, как только `msg.date < sinceUnix`;
  - возвращает массив `{ channelUsername, messageId, postedAt, text, url }`, где `url = "https://t.me/" + username + "/" + messageId`;
- Вокруг вызова — `try/catch`:
  - `FloodWaitError` → `await sleep(err.seconds * 1000 + 2000)` и один retry;
  - `ChannelPrivateError`, `UsernameNotOccupiedError`, `UsernameInvalidError` → `logger.warn`, возвращаем пустой массив;
- Между каналами в `run.ts` — `await sleep(CHANNEL_DELAY_MS + randomInt(0, 500))`.

### 7.4 `src/summarize.ts` — DeepSeek

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
});

export async function summarize(posts: Post[]): Promise<string /* html */> {
  const completion = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ posts }) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as DigestJson;
  validate(parsed); // ручная проверка полей, без zod
  return renderHtml(parsed);
}
```

Типы ответа — обычные `interface`. Валидация — `typeof`/`Array.isArray`, без внешних схем.

### 7.5 `src/deliver.ts` — отправка через Bot API

```ts
export async function sendToChannel(html: string): Promise<void> {
  const token = process.env.TG_BOT_TOKEN!;
  const chatId = process.env.TG_CHANNEL_ID!;
  const parts = chunkHtml(html, 4000); // запас от лимита 4096
  for (let i = 0; i < parts.length; i++) {
    const body = {
      chat_id: chatId,
      text: parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
}
```

`chunkHtml` режет по закрывающим тегам/переносам строки, чтобы не порвать HTML посередине. Перед вставкой пользовательского текста — экранирование `<`, `>`, `&` (остальное Telegram HTML пропустит без претензий).

### 7.6 `src/run.ts` — склейка

```ts
async function main() {
  const channels = loadChannelsYaml("./channels.yaml");
  const client = await createClient();
  await client.connect();

  const posts: Post[] = [];
  for (const { username } of channels) {
    posts.push(...await fetchLast24h(client, username, {
      limit: Number(process.env.MAX_MESSAGES_PER_CHANNEL ?? 50),
      windowHours: Number(process.env.FETCH_WINDOW_HOURS ?? 24),
    }));
    await sleep(Number(process.env.CHANNEL_DELAY_MS ?? 1000) + randomInt(0, 500));
  }
  await client.disconnect();

  if (posts.length === 0) {
    console.log("No posts in window — skipping digest");
    process.exit(0);
  }

  const html = await summarize(posts);
  await sendToChannel(html);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

---

## 8. Промпт для DeepSeek

### System

```
Ты — экстрактивный редактор русскоязычной ленты. На вход получаешь JSON { posts: [...] },
где posts[i] = { channelUsername, postedAt, text, url }.

Жёсткие правила:
1) Пиши ТОЛЬКО по фактам из text. Никаких домыслов, чисел или имён, отсутствующих в исходнике.
2) keyQuote каждой записи ДОЛЖЕН быть дословной подстрокой text (для верификации).
3) summary — 1–2 предложения на русском, до 250 символов.
4) Отбирай не более 15 самых содержательных постов в сумме по всем каналам.
5) Группировку по темам придумай сам — 3–6 групп, короткие заголовки.
6) Возвращай строго JSON без markdown и комментариев:
{
  "generatedAt": "ISO8601",
  "sections": [
    {
      "title": "Короткий заголовок темы",
      "items": [
        { "summary": "...", "keyQuote": "...", "url": "https://t.me/...", "channel": "username" }
      ]
    }
  ]
}
```

### User

Шлём сериализованный `{ posts: Post[] }`. После получения ответа сервер-сайд рендерит его в HTML по шаблону (тема → буллеты с цитатой в `<i>` и ссылкой `<a href="...">`). Рендер — чистая строка, без Handlebars.

---

## 9. Анти-бан правила (чек-лист)

Всё это должно быть реализовано в коде, не только упомянуто в документе:

- [ ] **Persistent StringSession.** Сессия генерируется один раз (`npm run login`) и кладётся в `.env`. Каждый запуск повторно переиспользует её, новые логины не выполняются.
- [ ] **Ограниченное окно чтения.** `offsetDate = now - FETCH_WINDOW_HOURS*3600`, `limit ≤ MAX_MESSAGES_PER_CHANNEL` (по умолчанию 50). Итерация останавливается, как только встретили пост старше окна.
- [ ] **Последовательность + jitter.** Каналы обрабатываются по одному. Между ними — `sleep(CHANNEL_DELAY_MS + randomInt(0, 500))`.
- [ ] **FloodWait.** Любой `FloodWaitError` ловится глобально: ждём `err.seconds * 1000 + 2000` и делаем один retry. Второй FloodWait подряд — прерываем прогон, логируем и выходим.
- [ ] **Частные ошибки каналов.** `ChannelPrivateError`, `UsernameNotOccupiedError`, `UsernameInvalidError` не валят прогон — канал пропускается.
- [ ] **Правдоподобный клиент.** При создании `TelegramClient` задаём `deviceModel`, `systemVersion`, `appVersion`, `langCode: "ru"`, `systemLangCode: "ru"`.
- [ ] **Частота запусков.** В README зафиксировано: не чаще одного прогона в 10–15 минут. Защиты в коде нет — дисциплина пользователя.

---

## 10. Запуск локально

```bash
# 1. Зависимости
npm install

# 2. Заполнить .env: TG_API_ID, TG_API_HASH, TG_BOT_TOKEN, TG_CHANNEL_ID, DEEPSEEK_API_KEY
cp .env.example .env

# 3. Разовая генерация user-сессии
npm run login
# → ввести телефон → код → (опц.) 2FA-пароль → скопировать TG_SESSION в .env

# 4. Подписать user-аккаунт на каналы из channels.yaml (руками, в клиенте Telegram)

# 5. Создать приватный канал, добавить бота админом, узнать TG_CHANNEL_ID
#    (например, переслать любое сообщение канала @username_to_id_bot)

# 6. Прогон
npm start
```

---

## 11. Критерии приёмки MVP

1. **Сбор.** На 15 каналах `npm start` завершается за < 60 секунд и не выбрасывает `FloodWaitError`.
2. **Суммаризация.** Для выборки из 20 постов `keyQuote` каждой записи дайджеста дословно найден в исходном `text` (проверяется вручную).
3. **Доставка.** В приватный канал приходит одно сообщение (или корректно пронумерованные части `(1/N)`), parse-mode HTML рендерится без ошибок.
4. **Идемпотентность запуска.** Повторный запуск через 15+ минут не триггерит FloodWait и не крэшит скрипт.
5. **Пустой день.** Если за 24 часа нет ни одного поста — скрипт логирует `No posts in window` и выходит с кодом 0 без похода в DeepSeek и без отправки в канал.

---

## 12. Известные ограничения

- Нет персистентности — одна и та же новость может попасть в дайджест несколько дней подряд, если канал её продолжает репостить.
- Нет дедупликации между каналами — один и тот же инфоповод из трёх каналов займёт три строки в дайджесте (частично гасится тем, что модель отбирает «15 самых содержательных», но гарантии нет).
- Нет классификации по направлениям — темы генерирует сама LLM на каждом прогоне, они могут плавать между запусками.
- Приватные каналы не поддерживаются (только публичные по `username`).
- Нет ретраев на уровне прогона — если DeepSeek или Telegram упали, скрипт выходит с кодом 1, оператор перезапускает руками.

---

## 13. Out of scope / дорожная карта

Всё перечисленное в целевой спецификации [SPEC.md](SPEC.md) сознательно оставлено "на потом":

- Postgres + pgvector для дедупа по cosine similarity.
- BullMQ + Redis, воркеры, DLQ.
- Docker Compose для локальной инфры.
- Cron (`croner`) на 20:00 MSK — тот же `src/run.ts` будет вызываться systemd-таймером или GitHub Actions.
- Классификатор направлений (бункеровка / масла / керосин / нефтехимия / битум) и компаний (TARGET / конкуренты).
- Эмбеддинги (OpenAI `text-embedding-3-small`) и Redis-кеш эмбеддингов.
- Handlebars-шаблон дайджеста вместо inline-рендера.
- `LLMProvider` / `EmbeddingProvider` / `Deliverer` абстракции — подменим DeepSeek на GigaChat/YandexGPT/локальный Qwen.
- Мульти-аккаунтная ротация TG-сессий.
- Dashboard, RAG, интеграции (Bitsab и пр.).

Этот MVP — самая дешёвая проверка связки «GramJS → LLM → Telegram». Следующим шагом мигрируем на [SPEC.md](SPEC.md) по мере появления реальных требований (устойчивость, дедуп, история).
