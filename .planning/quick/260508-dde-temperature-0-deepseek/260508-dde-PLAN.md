---
phase: 260508-dde-temperature-0-deepseek
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/summarize.ts
autonomous: true
requirements:
  - QUICK-260508-dde-01
must_haves:
  truths:
    - "Pass 1 (classifier) DeepSeek call sends temperature: 0"
    - "Pass 2 (per-category extraction) DeepSeek call sends temperature: 0"
    - "Два последовательных npm start на одном и том же наборе постов дают идентичный (или близкий к идентичному) дайджест"
  artifacts:
    - path: "src/summarize.ts"
      provides: "Both chat.completions.create calls now include temperature: 0"
      contains: "temperature: 0"
  key_links:
    - from: "src/summarize.ts:415-422 (Pass 1 classifier)"
      to: "DeepSeek chat.completions.create params"
      via: "temperature: 0 field on params object"
      pattern: "temperature: 0"
    - from: "src/summarize.ts:555-562 (Pass 2 per-category extraction)"
      to: "DeepSeek chat.completions.create params"
      via: "temperature: 0 field on params object"
      pattern: "temperature: 0"
---

<objective>
Сделать оба DeepSeek-вызова в `src/summarize.ts` квази-детерминистичными, добавив `temperature: 0` в параметры `client.chat.completions.create({...})`.

Purpose: Сейчас temperature не передаётся → DeepSeek использует дефолт 1.0 → два прогона `npm start` за 30 минут на одних и тех же постах дают разные дайджесты (Pass 1 по-разному относит посты к категориям, Pass 2 даёт разный keyQuote). Это ломает воспроизводимость и подрывает Core Value «каждая цитата дословно присутствует в исходном посте» — даже при честной экстракции keyQuote меняется от прогона к прогону.

Output: один atomic-коммит, две одинаковые правки в одном файле.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/summarize.ts

<discovery_summary>
Discovery выполнен orchestrator-ом до создания плана:

- Симптом: разные дайджесты на одних и тех же постах между прогонами.
- Корневая причина: `temperature` не задана ни в Pass 1, ни в Pass 2 → дефолт DeepSeek = 1.0 → высокая случайность.
- Фикс: `temperature: 0` (рекомендация DeepSeek для extraction-задач, см. https://api-docs.deepseek.com/quick_start/parameter_settings).
- Без `seed`: DeepSeek не гарантирует bit-exact reproducibility; `temperature: 0` даёт квази-детерминизм, чего достаточно для нашего use-case.
- Без новых зависимостей, без рефакторинга, без тестов — тривиальное добавление поля.
</discovery_summary>

<interfaces>
<!-- OpenAI-совместимый SDK (DeepSeek). Параметр temperature — number, опциональный. -->
<!-- Текущие объекты параметров (точная цитата из файла): -->

src/summarize.ts:415-422 (Pass 1 classifier):
```ts
const completion = await client.chat.completions.create({
  model,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ],
});
```

src/summarize.ts:555-562 (Pass 2 per-category extraction):
```ts
const completion = await client.chat.completions.create({
  model,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMsg },
  ],
});
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add temperature: 0 to both DeepSeek chat.completions.create calls in src/summarize.ts</name>
  <files>src/summarize.ts</files>
  <action>
Внести две одинаковые правки в существующие объекты параметров `client.chat.completions.create({...})` в `src/summarize.ts`. Никакого рефакторинга, никаких новых зависимостей, никаких изменений в других файлах (включая CLAUDE.md и README.md — это внутренний параметр, не публичный API).

Правка 1 — Pass 1 (classifier), строки 415–422.

Заменить блок:
```ts
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      });
```

на:
```ts
      const completion = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      });
```

Правка 2 — Pass 2 (per-category extraction), строки 555–562.

Заменить блок:
```ts
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    });
```

на:
```ts
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    });
```

Position обоих новых полей — сразу после `model,`, перед `response_format`. Стиль (отступ + trailing comma) совпадает с соседними полями объекта. Indent у Pass 1 — 8 пробелов (он внутри `callLLM` внутри `classifyChunk`); у Pass 2 — 6 пробелов (он внутри top-level `callLLM` в `summarizeCategory`). Сохранить существующие отступы — копировать их из соседних строк блока, не угадывать.

Не трогать ничего другого в файле: ни prompts, ни schema, ни retry-логику, ни логирование, ни parser. Только две строчки `temperature: 0,`.
  </action>
  <verify>
    <automated>grep -n "temperature: 0" src/summarize.ts | wc -l | tr -d ' ' | grep -qx 2 && npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>
1. `grep -n "temperature: 0" src/summarize.ts` возвращает ровно 2 совпадения — по одному рядом с каждым `chat.completions.create`.
2. `npx tsc --noEmit -p tsconfig.json` проходит без ошибок (TS strict).
3. Никаких других изменений в файле, кроме двух добавленных строк (`git diff src/summarize.ts` показывает diff из 2 added lines, 0 removed).
4. Файлы CLAUDE.md и README.md НЕ изменены.
  </done>
</task>

</tasks>

<verification>
Acceptance:
- `grep -c "temperature: 0" src/summarize.ts` → `2`.
- `npx tsc --noEmit` → exit 0.
- `git diff --stat src/summarize.ts` показывает только src/summarize.ts с +2/-0.
- Smoke (manual, optional, не блокирует merge): два последовательных `npm run start:once` на одном и том же 24h-окне дают идентичный или почти идентичный итоговый HTML-дайджест (Pass 1 buckets + Pass 2 keyQuote стабильны).
</verification>

<success_criteria>
- Оба DeepSeek-вызова в `src/summarize.ts` сериализуют `temperature: 0` в payload.
- TypeScript компилируется без ошибок.
- Изменён ровно один файл, добавлено ровно две строки.
- Atomic commit с conventional message формата `fix(260508-dde): set temperature: 0 in both DeepSeek calls for quasi-deterministic runs` (или аналогично — точный текст на усмотрение исполнителя, но scope = `260508-dde`).
</success_criteria>

<output>
After completion, create `.planning/quick/260508-dde-temperature-0-deepseek/260508-dde-SUMMARY.md`
</output>
