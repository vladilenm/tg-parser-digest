---
phase: quick-260519-tbo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/upload/llm.ts
  - src/bot.ts
  - src/__tests__/bot-summarize.test.ts
  - src/__tests__/upload-llm.test.ts
autonomous: true
requirements: [QUICK-260519-tbo]
must_haves:
  truths:
    - "/summarize narrative приходит в Telegram отрендеренным как HTML (жирные заголовки компаний, отступы), а не сырым Markdown с видимыми `###` и `---`"
    - "DeepSeek получает инструкцию писать только в HTML с whitelist-тегами (<b>, <i>, <code>, <pre>, <a>) и без markdown-конструкций (`#`, `**`, `*`, `---`)"
    - "Telegram Bot API принимает narrative-сообщения без ошибки на parse_mode (HTML рендерится, не отбивается с 400 «can't parse entities»)"
    - "upload-pipeline в handleDocument продолжает работать через sendMarkdown (структурный отчёт renderMarkdown НЕ трогаем)"
    - "npm test зелёный: все существующие тесты адаптированы под HTML"
  artifacts:
    - path: "src/upload/llm.ts"
      provides: "NARRATIVE_SYSTEM_PROMPT, переписанный под HTML"
      contains: "HTML"
    - path: "src/bot.ts"
      provides: "sendHtml() helper + переключение handleSummarizeCommand на sendHtml"
      contains: "sendHtml"
    - path: "src/__tests__/bot-summarize.test.ts"
      provides: "Тест на parse_mode=\"HTML\" для narrative"
      contains: "HTML"
    - path: "src/__tests__/upload-llm.test.ts"
      provides: "Fixtures с HTML-эквивалентами"
      contains: "<b>"
  key_links:
    - from: "src/bot.ts:handleSummarizeCommand"
      to: "src/bot.ts:sendHtml"
      via: "цикл по частям narrative"
      pattern: "sendHtml\\(token, chatId"
    - from: "src/bot.ts:sendHtml"
      to: "Telegram Bot API sendMessage"
      via: "parse_mode: \"HTML\""
      pattern: "parse_mode:\\s*[\"']HTML[\"']"
---

<objective>
Переключить LLM-narrative `/summarize` на Telegram HTML вместо Markdown V1.

Сейчас DeepSeek по NARRATIVE_SYSTEM_PROMPT пишет `### Заголовок`, `---`, `**bold**`, которые Telegram Markdown V1 не поддерживает — пользователь видит сырые маркеры в чате.

Решение: переписать промпт под HTML (`<b>...</b>` для заголовков, пустые строки + эмодзи-разделитель для блоков, никаких `<h1>/<hr>`), добавить `sendHtml()` в bot.ts и использовать его только в `handleSummarizeCommand`. `sendMarkdown` оставляем для `handleDocument` (там детерминированный шаблонный Markdown из `renderMarkdown`, формат отлажен).

Purpose: убрать визуальный мусор из чата трейдера; человеко-читаемый HTML-вывод.
Output: обновлённый промпт + новый sendHtml + переключённый вызов + зелёные тесты.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/upload/llm.ts
@src/bot.ts
@src/upload/renderer.ts
@src/__tests__/bot-summarize.test.ts
@src/__tests__/upload-llm.test.ts

<interfaces>
<!-- Ключевые контракты, чтобы исполнитель не лазил по кодовой базе. -->

From src/bot.ts (существующий паттерн sendMarkdown — основа для sendHtml):
```typescript
async function sendMarkdown(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await tgFetch<{ ok: boolean }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: MAIN_KEYBOARD,
  });
}
```

From src/upload/llm.ts (buildLlmNarrative использует chunkMarkdown):
```typescript
import { chunkMarkdown, CHUNK_LIMIT } from "./renderer.js";
// ...
const rawParts = chunkMarkdown(text, CHUNK_LIMIT - PREFIX_RESERVE);
```

From src/upload/renderer.ts:chunkMarkdown — режет по `\n\n` → `\n`.
Безопасен для HTML, **если** LLM строго использует переносы строк между логическими блоками
и НЕ переносит внутри открытого тега (`<b>текст\nещё</b>`). В промпте это запрещаем явно:
«каждый HTML-тег открывается и закрывается на одной строке».
Чанкер ищет ближайший `\n\n` от конца окна → разрыв всегда между блоками, не посреди тега.

Telegram Bot API HTML whitelist (актуально на 2026-05):
- `<b>`, `<strong>` — жирный
- `<i>`, `<em>` — курсив
- `<u>`, `<ins>` — подчёркнутый
- `<s>`, `<strike>`, `<del>` — зачёркнутый
- `<code>` — inline code
- `<pre>`, `<pre><code class="language-...">` — блок кода
- `<a href="...">` — ссылка
- `<blockquote>` — цитата
- `<tg-spoiler>` — спойлер

ВНЕ whitelist (Telegram падает с 400 "can't parse entities"):
- `<h1>`/`<h2>`/`<h3>` (любые заголовки)
- `<hr>` (разделитель)
- `<br>` (перевод строки — нужен `\n`)
- `<p>`, `<div>`, `<span>` (структурные блоки)
- любые атрибуты кроме `href` у `<a>`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Переписать NARRATIVE_SYSTEM_PROMPT под HTML</name>
  <files>src/upload/llm.ts</files>
  <action>
В `src/upload/llm.ts` переписать константу `NARRATIVE_SYSTEM_PROMPT` (строки 20-39) — заменить инструкцию о форматировании с Markdown на Telegram HTML.

Конкретные изменения внутри массива строк:

1. **Пункт 6 (форматирование)** — заменить:
   ```
   "6) Markdown-форматирование: *жирный* для заголовков компаний, абзацы через пустую строку.",
   ```
   на блок из 4–5 строк:
   ```
   "6) Формат ответа — Telegram HTML (НЕ Markdown). Разрешены ТОЛЬКО теги:",
   "   <b>...</b> — жирный (используй для заголовков компаний и важных чисел),",
   "   <i>...</i> — курсив, <code>...</code> — моноширинный.",
   "   ЗАПРЕЩЕНО: <h1>/<h2>/<h3>/<hr>/<br>/<p>/<div>/<span>, любые markdown-конструкции",
   "   (`#`, `##`, `###`, `**`, `*`, `---`, `==`), а также атрибуты HTML кроме href у <a>.",
   "   Каждый тег открывается и закрывается на одной строке (не переноси текст внутри тега).",
   "   Абзацы и блоки разделяй пустой строкой; если нужен визуальный сепаратор между компаниями —",
   "   используй строку из символа «━» (≈8-12 штук), а НЕ <hr> и НЕ ---.",
   ```

2. **Финальный абзац (строки 37-38)** — заменить:
   ```
   "Формат ответа — чистый Markdown (НЕ JSON). Без вступительных фраз вроде",
   "«Вот сводка:» — сразу к делу.",
   ```
   на:
   ```
   "Формат ответа — чистый Telegram HTML (НЕ JSON, НЕ Markdown). Без вступительных",
   "фраз вроде «Вот сводка:» — сразу к делу.",
   ```

3. **Не трогать**: пункты 1–5, 7, 8 (правила про экстрактивность, цифры, лимит — они не про формат). Не трогать сигнатуру `buildLlmNarrative`, `encodeAnalysisForLlm`, chunking, OpenAI-вызов.

Указать в комментарии-заголовке файла (строка 1-2) что narrative теперь HTML, а не Markdown — заменить «HTML-дайджест» / «markdown narrative» формулировки на HTML, чтобы будущий читатель не путался. Достаточно одной строки в шапке: `// quick-260519-tbo: narrative теперь Telegram HTML вместо Markdown V1.`

Импорт `chunkMarkdown` оставить как есть — он по факту безопасен и для HTML (рвёт по `\n\n`/`\n`, а промпт запрещает переносы внутри тегов).
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx tsc --noEmit 2>&1 | grep -E "upload/llm\.ts" || echo "no tsc errors in llm.ts"</automated>
  </verify>
  <done>
- В NARRATIVE_SYSTEM_PROMPT встречается подстрока «Telegram HTML» и НЕ встречается активная инструкция «Markdown» (кроме отрицания типа «НЕ Markdown»).
- В промпте явно перечислены разрешённые теги и запрет на `###`/`---`/`**`.
- `npx tsc --noEmit` чист по `src/upload/llm.ts`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Добавить sendHtml в bot.ts и переключить handleSummarizeCommand</name>
  <files>src/bot.ts</files>
  <action>
В `src/bot.ts`:

1. **Добавить функцию `sendHtml`** сразу после `sendMarkdown` (после строки 255). Это зеркало `sendMarkdown`, только `parse_mode: "HTML"`. Включить такой же `reply_markup: MAIN_KEYBOARD` и `disable_web_page_preview: true`:
   ```typescript
   /**
    * Шлёт HTML-сообщение (parse_mode: "HTML") — используется для LLM-narrative
    * /summarize (quick-260519-tbo). Telegram HTML whitelist: <b>, <i>, <u>, <s>,
    * <code>, <pre>, <a>, <blockquote>, <tg-spoiler>. Без <h1>/<hr>/<br>.
    * Если LLM сгенерит запрещённый тег — Bot API ответит 400 "can't parse entities"
    * и tgFetch бросит, что поймает try/catch в handleSummarizeCommand.
    */
   async function sendHtml(
     token: string,
     chatId: number,
     text: string
   ): Promise<void> {
     await tgFetch<{ ok: boolean }>(token, "sendMessage", {
       chat_id: chatId,
       text,
       parse_mode: "HTML",
       disable_web_page_preview: true,
       reply_markup: MAIN_KEYBOARD,
     });
   }
   ```

2. **В `handleSummarizeCommand`** заменить строку 498:
   ```
   await sendMarkdown(token, chatId, part);
   ```
   на:
   ```
   await sendHtml(token, chatId, part);
   ```

3. **НЕ трогать** вызов `sendMarkdown` в `handleDocument` (строка ~390) — там идёт детерминированный Markdown V1 из `renderMarkdown(result)`, который отлажен и не содержит запрещённых конструкций.

4. **НЕ удалять** `sendMarkdown` — он остаётся для upload-pipeline.

Запустить `npx tsc --noEmit` — должно быть чисто.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npx tsc --noEmit 2>&1 | tee /tmp/tsc-tbo.log | grep -E "error TS" | head -20 || echo "OK no tsc errors"</automated>
  </verify>
  <done>
- В `src/bot.ts` определена `async function sendHtml(...)` с `parse_mode: "HTML"`.
- В `handleSummarizeCommand` цикл `for (const part of parts)` вызывает `sendHtml`, НЕ `sendMarkdown`.
- В `handleDocument` остался `sendMarkdown` (не тронут).
- `npx tsc --noEmit` без ошибок.
  </done>
</task>

<task type="auto">
  <name>Task 3: Обновить тесты под HTML и прогнать npm test</name>
  <files>src/__tests__/bot-summarize.test.ts, src/__tests__/upload-llm.test.ts</files>
  <action>
1. **`src/__tests__/bot-summarize.test.ts`** — найти строку с `expect(narrative!.parse_mode).toBe("Markdown");` (около строки 217 внутри теста «calls buildLlmNarrative and sends parts via sendMessage(parse_mode=Markdown)»):
   - Заменить `"Markdown"` → `"HTML"`.
   - Переименовать в тесте описание/`it()`: `parse_mode=Markdown` → `parse_mode=HTML`.
   - В моке `mockedBuildLlmNarrative.mockResolvedValue([...])` заменить markdown-fixture `"*Сводка*\n\nЗа период..."` на HTML-эквивалент `"<b>Сводка</b>\n\nЗа период с 30 апреля по 8 мая лидирует Газпромнефть."`. Assert `narrative!.text` toContain «Газпромнефть» — продолжает работать.

   Второй тест («sends each narrative chunk as a separate sendMessage call») не проверяет parse_mode явно — можно оставить fixture как есть («(1/2)\nчасть один»), но для консистентности заменим внутренние строки на простой текст без markdown-маркеров. Это не обязательно для прохождения теста — он смотрит только на наличие подстрок «часть один» / «часть два».

2. **`src/__tests__/upload-llm.test.ts`** — два места с `"*Сводка*\n\n..."`:
   - Тест «returns a single-part array when DeepSeek response is short» (строки ~127-134): заменить fixture `"*Сводка*\n\nЗа период..."` на `"<b>Сводка</b>\n\nЗа период с 30 апреля по 8 мая лидирует Газпромнефть."`. Assert `parts[0]).toContain("Газпромнефть")` продолжает работать.
   - Тест «chunks long responses» (строки ~184-198): fixture `"Газпромнефть продолжает доминировать. "` не содержит markdown-маркеров, оставить как есть. Можно опционально обернуть слово в `<b>Газпромнефть</b>` для реалистичности — на assert не влияет.

3. **Не трогать**: assertions про temperature=0, response_format undefined, model fallbacks, allowlist gating, error handling — они формат-нейтральны.

4. Запустить `npm test`. Все тесты (включая 619 существующих) должны быть зелёные.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo && npm test 2>&1 | tail -30</automated>
  </verify>
  <done>
- В `src/__tests__/bot-summarize.test.ts` проверка `parse_mode` для narrative ожидает `"HTML"`.
- Fixtures `*...*` markdown заменены на `<b>...</b>` HTML в обоих тест-файлах.
- `npm test` финиширует без падений (все тесты passed).
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` — без ошибок.
- `npm test` — все тесты зелёные.
- Ручная проверка (опционально, не блокер): запустить бота локально (`npm start` / `npm run start:bot`), послать `/summarize` в DM с уже загруженной парой prices+fca, убедиться что в чате приходит narrative с жирными заголовками и без видимых `###`/`**`/`---`.
</verification>

<success_criteria>
- DeepSeek инструктирован выдавать Telegram HTML (whitelist tags) и не использовать markdown-маркеры.
- `handleSummarizeCommand` шлёт narrative через `sendHtml` с `parse_mode: "HTML"`.
- `handleDocument` (upload-pipeline) не затронут — продолжает использовать `sendMarkdown`.
- Тесты обновлены, npm test зелёный.
</success_criteria>

<output>
After completion, create `.planning/quick/260519-tbo-llm-narrative-summarize-telegram-html-ma/260519-tbo-SUMMARY.md` по шаблону GSD.
</output>
