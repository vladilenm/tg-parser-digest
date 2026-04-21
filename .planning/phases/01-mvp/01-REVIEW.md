---
phase: 01-mvp
reviewed: 2026-04-21T12:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - scripts/login.ts
  - src/types.ts
  - src/telegram.ts
  - src/summarize.ts
  - src/deliver.ts
  - src/run.ts
  - package.json
  - tsconfig.json
  - channels.yaml
  - .env.example
  - README.md
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 01-mvp: Code Review Report

**Reviewed:** 2026-04-21T12:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Проведён стандартный ревью MVP-пайплайна tg-parser-demo (GramJS → DeepSeek → Bot API). Ядро защиты от галлюцинаций (серверная верификация `keyQuote` через `post.text.includes(item.keyQuote.trim())`) реализовано корректно и соответствует D-01..D-05. Anti-ban identity и FloodWait-логика не содержат бесконечных циклов. Secrets не логируются в stdout/stderr; `.env.example` без реальных значений.

Критических проблем безопасности или корректности не найдено. Основные замечания — в `chunkHtml` (может разрезать HTML посередине тега/внутри атрибута при аномальном входе) и в мелких нюансах обработки ошибок. Все Warning-findings — граничные сценарии, маловероятные в штатной работе MVP; однако перечислены явно, т. к. часть из них связана с Core Value (дословность цитат) и с риском получить `Bad Request` от Telegram Bot API.

## Warnings

### WR-01: `chunkHtml` может разорвать HTML внутри атрибута `href`

**File:** `src/deliver.ts:36-38`
**Issue:** Fallback на приоритете 3 использует `window.lastIndexOf(" ")` для поиска разрыва по пробелу. Если в пределах окна `[0, max]` последний пробел находится внутри атрибута открытого тега, например в `<a href="https://t.me/..." >` (Telegram HTML допускает такой формат) или между словами внутри `keyQuote`, разрыв сломает тег: начало окажется в части N, а закрывающая `>` / `"` — в части N+1. При `parse_mode: HTML` это даёт `Bad Request: can't parse entities`. На реальных дайджестах это маловероятно (есть `\n\n` между секциями), но код не гарантирует инвариант «режем только на границе тега». README §Troubleshooting уже упоминает этот сценарий.
**Fix:** Перед тем как использовать `lastSpace`, проверить, что он находится вне открытого тега. Минимальная эвристика:

```ts
// Приоритет 3: пробел, но только если после него нет незакрытого "<" слева.
const lastSpace = window.lastIndexOf(" ");
if (lastSpace > cutAt) {
  const openTag = window.lastIndexOf("<", lastSpace);
  const closeTag = window.lastIndexOf(">", lastSpace);
  if (openTag <= closeTag) cutAt = lastSpace; // тег закрыт до пробела
}
```

Либо: полностью отказаться от fallback по пробелу и в крайнем случае резать по `max` (приоритет 4 в текущем коде уже есть). На нашей HTML-структуре (`\n\n` между секциями + `\n` между буллетами) это почти никогда не даст ухудшения.

### WR-02: `chunkHtml` при гигантском одиночном буллете > 4000 символов порвёт тег по `cutAt = max`

**File:** `src/deliver.ts:39-43`
**Issue:** Если пост содержит один буллет длиннее 4000 символов без внутренних переносов (Telegram сам не переносит, а `escapeHtml` не добавляет `\n`), то `window.lastIndexOf("\n\n")`, `"\n"` и `" "` могут все вернуть значение `< max*0.5` (или даже `-1`), и fallback `cutAt = max` (строка 42) разрежет буллет посередине HTML-тега — например, внутри `<i>«...»</i>` или `<a href="...">`. Результат: `parse_mode: HTML` отвергнет сообщение с `Bad Request`. В MVP это маловероятно (`summary ≤ 250` символов по промпту, `keyQuote` — дословная цитата ≤ длины поста, и пост обычно короче 4000), но нет жёсткой гарантии. Safety-check на строке 69 (`text.length > TELEGRAM_LIMIT`) поймает переполнение, но не разрушение HTML.
**Fix:** При `cutAt <= 0` (не нашли хорошего разрыва) не резать по `max`, а бросать Error с понятным сообщением — оператор увидит конкретный буллет и пофиксит вручную:

```ts
if (cutAt <= 0) {
  throw new Error(
    `chunkHtml: cannot find safe break in window of ${max} chars ` +
    `(no \\n\\n / \\n / space found). First 200 chars: ${window.slice(0, 200)}`
  );
}
```

Это fail-fast предпочтительнее, чем скрытый `Bad Request: can't parse entities` от Telegram.

### WR-03: Отсутствует проверка, что префикс `(i/N)` + часть укладывается в `max`

**File:** `src/deliver.ts:64-73`
**Issue:** `chunkHtml(html, CHUNK_SAFE_LIMIT=4000)` возвращает части ≤ 4000 символов. Затем в цикле доставки для каждой части префиксуется `(i+1/N)\n` длиной 4–8 символов (при N ≤ 99). Финальная проверка `text.length > TELEGRAM_LIMIT=4096` (строка 69) корректно срабатывает при переполнении, но бросает Error посреди цикла — то есть **часть 1 уже могла быть отправлена в канал**, а часть 2 упала. Оператор получит частичный дайджест + ошибку. В MVP идемпотентность не реализована (пометка в README) — повторный запуск пришлёт ещё один частичный.
**Fix:** Сделать безопасность за счёт меньшего `CHUNK_SAFE_LIMIT`, учитывающего префикс заранее:

```ts
const CHUNK_SAFE_LIMIT = 4000 - 10; // запас 96 на (999/999)\n + огрехи
```

Или валидировать длину ДО начала цикла отправки:

```ts
const parts = chunkHtml(html, CHUNK_SAFE_LIMIT);
for (let i = 0; i < parts.length; i++) {
  const text = parts.length > 1 ? `(${i+1}/${parts.length})\n${parts[i]}` : parts[i];
  if (text.length > TELEGRAM_LIMIT) throw new Error(...);
}
// После полной валидации — второй проход для отправки
for (let i = 0; i < parts.length; i++) { ... fetch ... }
```

Тогда частичной отправки не будет.

### WR-04: Дублирование файла `.env` не защищено — `.env.local` в `.gitignore`, но других вариантов нет

**File:** `.env.example` + (подразумевается `.gitignore`)
**Issue:** Плановый `.gitignore` содержит только `.env` и `.env.local`. Оператор может создать `.env.backup`, `.env.old`, `.env.prod` при ручных экспериментах — эти файлы не блокируются git и могут случайно попасть в коммит, содержа `TG_SESSION` / `TG_BOT_TOKEN` / `DEEPSEEK_API_KEY` (полный доступ к user-аккаунту). README на строке 47 явно предупреждает «Не публикуй TG_SESSION», но это дисциплина, не код.
**Fix:** Расширить `.gitignore` glob-паттерном:

```
.env
.env.*
!.env.example
```

Это заблокирует любые `.env.<suffix>` кроме явно разрешённого `.env.example`. Документировать в README.

### WR-05: `Number(process.env.X)` не валидирует NaN для параметров прогона

**File:** `src/run.ts:43-45`
**Issue:** Если оператор случайно впишет `FETCH_WINDOW_HOURS=abc` или оставит значение с пробелами, `Number(...)` вернёт `NaN`. Дальше `NaN * 3600` = `NaN`, и в `src/telegram.ts:67` вычисление `sinceUnix = Math.floor(Date.now() / 1000) - NaN` = `NaN`. Сравнение `date < NaN` всегда `false` → итерация **никогда не остановится по окну**, пойдёт до `limit=50` сообщений на канал, и в дайджест попадут посты старше 24 часов. Core Value «события за 24 часа» нарушается тихо, без ошибки.
**Fix:** Добавить валидацию:

```ts
function envNumber(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} должно быть положительным числом, получено: "${raw}"`);
  }
  return n;
}

const limit = envNumber("MAX_MESSAGES_PER_CHANNEL", 50);
const windowHours = envNumber("FETCH_WINDOW_HOURS", 24);
const channelDelayMs = envNumber("CHANNEL_DELAY_MS", 1000);
```

## Info

### IN-01: Unicode-нормализация в `keyQuote` может давать ложные skip

**File:** `src/summarize.ts:120`
**Issue:** `post.text.includes(needle)` сравнивает строки побайтно. Если DeepSeek возвращает `keyQuote` в другой Unicode-нормализации (NFC vs NFD), или заменяет неразрывные пробелы (U+00A0) на обычные (U+0020), совпадение не найдётся — запись скипнется с warn. Это БЕЗОПАСНО для Core Value (false negative, не hallucination), но оператор увидит потерю данных в дайджесте без очевидной причины. D-02 явно запрещает whitespace-нормализацию и case-insensitive — текущее поведение ей соответствует.
**Fix:** Оставить как есть — дизайн-решение (D-02) сознательно выбирает строгость. Если в будущем появятся жалобы на потери — добавить опциональный `post.text.normalize("NFC").includes(needle.normalize("NFC"))` как второй проход с логом `matched_after_nfc`.

### IN-02: `as unknown as { date?: number }` каст повторяется 4 раза в `fetchLast24h`

**File:** `src/telegram.ts:79-90`
**Issue:** Повторяющиеся касты `(msg as unknown as { date?: number }).date` мешают читаемости. GramJS `Api.Message` имеет неполные типы — это известный нюанс библиотеки.
**Fix:** Создать локальный type-guard или helper:

```ts
interface RawMessage { id?: number | bigint; date?: number; message?: string; }
function asRawMessage(m: unknown): RawMessage { return m as RawMessage; }

for await (const msg of iter) {
  const m = asRawMessage(msg);
  const date = typeof m.date === "number" ? m.date : 0;
  // ...
}
```

Чисто для читаемости; функционально эквивалентно.

### IN-03: `process.exit(0)` внутри `main()` вместо естественного `return`

**File:** `src/run.ts:74, 81`
**Issue:** `main()` сам вызывает `process.exit(0)` в двух местах — при пустом дне и после успешной отправки. Это работает, но мешает unit-тестированию и делает `main().catch(...)` на строке 85 неполным (если main бросит до `exit(0)`, catch сработает; если main достигнет `exit(0)`, promise никогда не resolve'нется — OK для CLI, но нестандартно).
**Fix:** Заменить на `return` и вынести `process.exit` в глобальный handler:

```ts
async function main(): Promise<number> {
  // ...
  if (posts.length === 0) { console.log("No posts..."); return 0; }
  // ...
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => { console.error(err); process.exit(1); });
```

Не обязательно для MVP.

### IN-04: Безмолвное исключение постов с пустым текстом (`text=""` / undefined)

**File:** `src/telegram.ts:86-87`
**Issue:** Репосты-только-медиа (фото/видео без подписи) имеют `msg.message === ""` и пропускаются без лога. Оператор не видит «15 постов в канале, но 10 из них — медиа без текста». В MVP это не критично (спецификация §7.3 допускает это как Claude's Discretion), но в отладке может сбить с толку при проверке критерия 2 приёмки.
**Fix:** Добавить счётчик пропущенных медиа и финальный лог в `fetchLast24h`, например:

```ts
let skippedMedia = 0;
// ... в цикле: if (!text) { skippedMedia++; continue; }
if (skippedMedia > 0) {
  console.log(`[telegram] ${username}: пропущено ${skippedMedia} медиа-постов без текста`);
}
```

### IN-05: Приоритетный fallback в `chunkHtml` с `max * 0.5` — магическая константа

**File:** `src/deliver.ts:28, 33`
**Issue:** Порог 50% (`Math.floor(max * 0.5)`) выбран без обоснования. Он управляет балансом: «лучше неравномерные части, но по `\n\n`» vs «более равномерные, но по пробелу». Магическое число без комментария.
**Fix:** Вынести в константу с именем:

```ts
const MIN_CHUNK_FILL = 0.5; // минимум 50% окна — иначе слишком неравномерно
```

Это косметика.

### IN-06: README §Troubleshooting упоминает `sendMessage failed: 400` как «HTML-теги разрушились»

**File:** `README.md:107-109`
**Issue:** Сообщение «Скорее всего HTML-теги разрушились при разрезе. Проверь, что `src/summarize.ts` не был изменён и экранирует `<`, `>`, `&`». Причина диагностики неполна: разрушение возможно не только в `summarize`, но и в `chunkHtml` (см. WR-01, WR-02). Оператор, следующий README, будет искать проблему не там.
**Fix:** Расширить troubleshooting-пункт:

```markdown
### `Telegram sendMessage failed: 400`

Возможные причины:
1. HTML-теги разрушились при разрезе — см. `src/deliver.ts chunkHtml` (разрыв внутри открытого тега).
2. `escapeHtml` в `src/summarize.ts` был изменён и пропускает `<` / `>` / `&` в пользовательском тексте.
3. `TG_CHANNEL_ID` указывает на канал, где бот не админ (проверить правa Post Messages).

Включи логирование: добавь `console.error(text)` перед `fetch` в `sendToChannel`,
запусти ещё раз, скопируй `text` в любой HTML-валидатор.
```

---

_Reviewed: 2026-04-21T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
