---
phase: quick-260501-bzh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/deliver.ts
  - src/summarize.ts
autonomous: true
requirements:
  - QUICK-260501-bzh-FIX1
  - QUICK-260501-bzh-FIX2

must_haves:
  truths:
    - "chunkHtml больше никогда не режет HTML посреди тега <i>«…»</i>: разрыв возможен только на \\n\\n или \\n."
    - "Если в окне нет ни \\n\\n, ни \\n — chunkHtml бросает диагностический Error с длиной и началом фрагмента (тихого среза по max или по пробелу больше нет)."
    - "OpenAI-клиент в summarize создаётся с timeout=120_000 и maxRetries=1 — повисший DeepSeek упадёт за 2 минуты, а не за 10."
    - "В логах прогона видно [summarize] sending N posts ... перед запросом к DeepSeek и [summarize] response received in Xms — после."
    - "Перед retry-запросом к DeepSeek в логах видно [summarize] retry attempt after schema-validation failure."
  artifacts:
    - path: "src/deliver.ts"
      provides: "chunkHtml без приоритета 'last space', с throw на отсутствие переноса"
      contains: "chunkHtml: bullet exceeds CHUNK_SAFE_LIMIT"
    - path: "src/summarize.ts"
      provides: "OpenAI с timeout=120_000, maxRetries=1; info-логи вокруг ask() и перед retry"
      contains: "timeout: 120_000"
  key_links:
    - from: "src/summarize.ts"
      to: "src/logger.ts"
      via: "import { log } from './logger.js'"
      pattern: "from \"\\./logger\\.js\""
---

<objective>
Two surgical bug fixes diagnosed by the user, no exploration needed.

1. **chunkHtml** в `src/deliver.ts` режет HTML посередине `<i>«…»</i>` из-за fallback на «последний пробел». Telegram Bot API возвращает 400 «Can't find end tag corresponding to start tag i». Чиним: убираем space-fallback, разрешаем разрыв только на `\n\n`/`\n`, иначе throw.
2. **summarize** в `src/summarize.ts` создаёт OpenAI-клиент без таймаута (default 10 мин) и без логов вокруг запроса. Когда DeepSeek висит — процесс выглядит мёртвым. Чиним: `timeout: 120_000`, `maxRetries: 1`, info-логи перед запросом / после ответа / перед retry.

Purpose: восстановить надёжную доставку дайджеста и убрать «слепую зону» при медленном/висящем DeepSeek.
Output: правки в двух файлах; никаких новых файлов, никаких новых зависимостей.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/deliver.ts
@src/summarize.ts
@src/logger.ts

<interfaces>
<!-- Контракт логгера, который будет использоваться в summarize.ts -->
From src/logger.ts:
```typescript
export const log = {
  info(msg: string, ...ctx: unknown[]): void,
  warn(msg: string, ...ctx: unknown[]): void,
  error(msg: string, ...ctx: unknown[]): void,
};
```

<!-- Сигнатура chunkHtml не меняется -->
From src/deliver.ts:
```typescript
export function chunkHtml(html: string, max?: number): string[];
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix chunkHtml — remove space-fallback, throw on no newline</name>
  <files>src/deliver.ts</files>
  <action>
В файле `src/deliver.ts` заменить тело цикла `while (remaining.length > max)` внутри функции `chunkHtml` так, чтобы:

1. Полностью **удалить Приоритет 3** (строки 33–38: блок «последний пробел»). Никакого fallback на пробел больше нет.
2. Полностью **удалить порог `< Math.floor(max * 0.5)`** для Приоритета 2: если `\n\n` не найден (`cutAt === -1`), сразу пробуем `\n` (последний в окне). Если найден — используем `cutAt = singleLf`.
3. Полностью **удалить fallback-блок `if (cutAt <= 0) { cutAt = max; }`** (строки 39–43). Вместо тихого среза по `max` — бросать ошибку.
4. Если **ни `\n\n`, ни `\n`** не найдены в окне (`cutAt < 0` после обеих попыток) — `throw new Error(`chunkHtml: bullet exceeds CHUNK_SAFE_LIMIT (max=${max}); offending fragment length=${window.length}, starts: ${window.slice(0, 80)}...`)`.

Итоговая логика поиска `cutAt`:
```ts
const window = remaining.slice(0, max);
let cutAt = window.lastIndexOf("\n\n");          // Приоритет 1
if (cutAt < 0) cutAt = window.lastIndexOf("\n"); // Приоритет 2
if (cutAt < 0) {
  throw new Error(
    `chunkHtml: bullet exceeds CHUNK_SAFE_LIMIT (max=${max}); offending fragment length=${window.length}, starts: ${window.slice(0, 80)}...`
  );
}
parts.push(remaining.slice(0, cutAt).trimEnd());
remaining = remaining.slice(cutAt).trimStart();
```

Также обновить doc-комментарий над функцией: оставить пункты 1 и 2, удалить упоминание «3. Пробел». Добавить строку: «Если в окне нет ни \\n\\n, ни \\n — бросаем Error (буллет шире лимита). Это инвариант: каждый буллет — одна строка.»

**НЕ ТРОГАТЬ:** сигнатуру функции, экспорт, `sendToChannel`, константы `TELEGRAM_LIMIT` / `CHUNK_SAFE_LIMIT`, ранний return `if (html.length <= max) return [html];`, финальный `if (remaining.length > 0) parts.push(remaining);`.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p . && node --input-type=module -e "import('./src/deliver.ts').then(m => { const html = ['• <i>«' + 'a'.repeat(50) + '»</i>', '• <i>«' + 'b'.repeat(50) + '»</i>', '• <i>«' + 'c'.repeat(50) + '»</i>'].join('\\n'); const out = m.chunkHtml(html, 80); for (const p of out) { const opens = (p.match(/<i>/g)||[]).length; const closes = (p.match(/<\\/i>/g)||[]).length; if (opens !== closes) { console.error('UNBALANCED', { opens, closes, p }); process.exit(1); } } console.log('OK chunks=' + out.length); }).catch(e => { console.error(e.message); process.exit(1); });"</automated>
  </verify>
  <done>
- В `chunkHtml` нет ни одного `lastIndexOf(" ")`, нет блока `cutAt = max`, нет `* 0.5`.
- При входе, где буллет помещается в окно, разрыв происходит на `\n\n` или `\n`; число `<i>` равно числу `</i>` в каждом чанке.
- При входе, где один «буллет» длиннее `max` и не содержит `\n` — `chunkHtml` бросает Error с подстрокой `"chunkHtml: bullet exceeds CHUNK_SAFE_LIMIT"`.
- `npx tsc --noEmit -p .` проходит без ошибок.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add timeout + visibility logs to summarize</name>
  <files>src/summarize.ts</files>
  <action>
В файле `src/summarize.ts`:

1. **Импорт логгера.** В блок импортов (после строки `import { DigestJsonSchema } from "./schema.js";`) добавить:
   ```ts
   import { log } from "./logger.js";
   ```

2. **Таймаут OpenAI-клиента.** Заменить строку
   ```ts
   const client = new OpenAI({ apiKey, baseURL });
   ```
   на:
   ```ts
   const client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 1 });
   ```

3. **Логи вокруг ask().** В теле helper-функции `ask`, **перед** строкой `const completion = await client.chat.completions.create({...})`, добавить:
   ```ts
   const startedAt = Date.now();
   log.info(`[summarize] sending ${posts.length} posts to DeepSeek (model=${model})`);
   ```
   Сразу **после** `const completion = await client.chat.completions.create({...});` (т.е. на следующей строке после awaited completion, до `const raw = ...`) добавить:
   ```ts
   log.info(`[summarize] response received in ${Date.now() - startedAt}ms`);
   ```

4. **Лог перед retry.** В блоке `if (!result.success) { ... }`, **перед** второй строкой `parsed = await ask("Предыдущий ответ ...")`, после существующего `console.warn(...)` добавить:
   ```ts
   log.info("[summarize] retry attempt after schema-validation failure");
   ```

**НЕ ТРОГАТЬ:** SYSTEM_PROMPT, escapeHtml, formatDateRu, verifyExtractiveness, renderItem, renderHtml, SECTION_HEADERS, MENTION_LABEL, существующие `console.warn` / `console.error` (оставляем как есть, не мигрируем на log.* — задача surgical), сигнатуру `summarize(posts)`, тип возвращаемого значения, логику Zod-валидации и retry.

**Замечание по типу `timeout`:** `OpenAI`-клиент из пакета `openai` принимает `timeout: number` (миллисекунды) и `maxRetries: number` напрямую в конструкторе — никаких приведений типа делать не нужно, TS строгий, но опции в типе есть.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p . && node --input-type=module -e "import('./src/summarize.ts').then(() => console.log('OK module loads')).catch(e => { console.error(e.message); process.exit(1); });" && grep -q "timeout: 120_000" src/summarize.ts && grep -q "maxRetries: 1" src/summarize.ts && grep -q 'sending .* posts to DeepSeek' src/summarize.ts && grep -q 'response received in' src/summarize.ts && grep -q 'retry attempt after schema-validation failure' src/summarize.ts && grep -q 'from "./logger.js"' src/summarize.ts && echo OK</automated>
  </verify>
  <done>
- В `src/summarize.ts` есть `import { log } from "./logger.js";`.
- `new OpenAI(...)` вызван с `timeout: 120_000, maxRetries: 1`.
- В `ask` зафиксированы три строки логов: «sending N posts», «response received in Xms», и одна строка «retry attempt» — перед вторым вызовом `ask`.
- `npx tsc --noEmit -p .` проходит без ошибок.
- Никаких изменений в публичном API (`summarize`, `escapeHtml`, `renderHtml` экспорты сохранены).
  </done>
</task>

</tasks>

<verification>
Общая проверка после двух задач:

1. `npx tsc --noEmit -p .` — без ошибок (strict TS, ESM, no build).
2. `grep -n 'lastIndexOf(" ")' src/deliver.ts` — пусто (space-fallback удалён).
3. `grep -n 'cutAt = max' src/deliver.ts` — пусто (тихий срез удалён).
4. `grep -n 'timeout: 120_000' src/summarize.ts` — одна строка.
5. `grep -n 'log.info' src/summarize.ts` — минимум три попадания (sending / response / retry).
6. Smoke на синтетическом HTML (см. `<verify>` Task 1) — все чанки имеют сбалансированные `<i>`/`</i>`.
</verification>

<success_criteria>
- Оба файла собираются под `tsx`/`tsc --noEmit` без ошибок.
- `chunkHtml` либо режет на `\n\n`/`\n`, либо бросает понятный Error — никогда не возвращает чанк с разорванным тегом.
- `summarize` падает максимум за ~120с при висящем DeepSeek (а не за 10 мин), и пишет в stdout видимые маркеры запроса/ответа/ретрая, которые PM2 подхватит в `pm2-out.log`.
- Поведение остальных модулей (sendToChannel, renderHtml, verifyExtractiveness, схема Zod) не изменено.
</success_criteria>

<output>
After completion, create `.planning/quick/260501-bzh-deliver-chunkhtml-summarize/260501-bzh-SUMMARY.md`.
</output>
