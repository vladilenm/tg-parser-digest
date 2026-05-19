---
phase: quick-260519-tbo
plan: 01
subsystem: bot / upload-llm
tags: [bot, telegram, deepseek, html, summarize, formatting]
dependency-graph:
  requires:
    - "src/upload/llm.ts (buildLlmNarrative, NARRATIVE_SYSTEM_PROMPT)"
    - "src/bot.ts (handleSummarizeCommand, sendMarkdown, MAIN_KEYBOARD, tgFetch)"
    - "src/upload/renderer.ts (chunkMarkdown, CHUNK_LIMIT)"
  provides:
    - "sendHtml() helper in bot.ts (parse_mode: HTML)"
    - "NARRATIVE_SYSTEM_PROMPT instructing DeepSeek to emit Telegram HTML whitelist tags"
  affects:
    - "Telegram /summarize narrative output (rendered HTML instead of raw markdown)"
tech-stack:
  added: []
  patterns:
    - "Telegram Bot API parse_mode: HTML whitelist (<b>, <i>, <code>, <a>, ...) — no <h1>/<hr>/<br>"
    - "Mirror helper pattern (sendMarkdown / sendHtml) for two parse modes side-by-side"
key-files:
  created: []
  modified:
    - "src/upload/llm.ts (NARRATIVE_SYSTEM_PROMPT rewrite + file header comment)"
    - "src/bot.ts (new sendHtml helper + handleSummarizeCommand uses sendHtml)"
    - "src/__tests__/bot-summarize.test.ts (parse_mode=HTML assertion + HTML fixture)"
    - "src/__tests__/upload-llm.test.ts (HTML fixture for single-part test)"
decisions:
  - "Keep sendMarkdown for handleDocument (upload-pipeline renderMarkdown is deterministic and already debugged); only handleSummarizeCommand switches to HTML"
  - "Use Telegram HTML whitelist (<b>, <i>, <code>) rather than MarkdownV2 — fewer escape pitfalls and no need to backslash-escape numbers/punctuation"
  - "Visual company separator: Unicode line ━ instead of <hr> (forbidden) or --- (markdown leak)"
  - "Comment in handleSummarizeCommand docstring updated to reflect sendHtml (consistency)"
metrics:
  duration: "121s"
  completed: 2026-05-19
  tasks: 3
  files_modified: 4
  files_created: 0
  tests_passing: 2601
---

# Phase quick-260519-tbo Plan 01: LLM-narrative /summarize → Telegram HTML Summary

Переключили DeepSeek-narrative `/summarize` с Markdown V1 на Telegram HTML: переписали NARRATIVE_SYSTEM_PROMPT под HTML whitelist, добавили `sendHtml()` helper в `bot.ts` и переключили только `handleSummarizeCommand` (upload-pipeline остался на `sendMarkdown`).

## What Changed

### Task 1: NARRATIVE_SYSTEM_PROMPT → Telegram HTML
- В `src/upload/llm.ts` заменили пункт 6 правил с markdown-инструкции (`*жирный* для заголовков`) на блок из 8 строк с описанием Telegram HTML whitelist:
  - Разрешены: `<b>`, `<i>`, `<code>` (можно использовать `<a>` через ссылку, но он редок в narrative).
  - Запрещены: `<h1>/<h2>/<h3>/<hr>/<br>/<p>/<div>/<span>`, любые markdown-маркеры (`#`, `##`, `###`, `**`, `*`, `---`, `==`), любые HTML-атрибуты кроме `href` у `<a>`.
  - Правило «каждый тег открывается/закрывается на одной строке» — защита от того, чтобы chunkMarkdown не разорвал текст внутри открытого тега.
  - Визуальный сепаратор между компаниями — Unicode-линия `━` (≈8-12 штук), вместо `<hr>` или `---`.
- Финальный абзац промпта: «Формат ответа — чистый Telegram HTML (НЕ JSON, НЕ Markdown)».
- В шапке файла добавили строку `// quick-260519-tbo: narrative теперь Telegram HTML вместо Markdown V1.` + заменили «markdown narrative» на «HTML narrative» в существующем комментарии.
- Не тронуты: пункты 1–5, 7, 8 промпта; сигнатура `buildLlmNarrative`; `encodeAnalysisForLlm`; chunking; OpenAI-вызов.

### Task 2: sendHtml + переключение handleSummarizeCommand
- В `src/bot.ts` добавили `async function sendHtml(token, chatId, text)` сразу после `sendMarkdown` (зеркало с `parse_mode: "HTML"`, тот же `disable_web_page_preview: true` и `reply_markup: MAIN_KEYBOARD`). Docstring пояснил Telegram HTML whitelist и то, что 400 «can't parse entities» поймается try/catch в `handleSummarizeCommand`.
- В `handleSummarizeCommand` цикл `for (const part of parts)` теперь вызывает `sendHtml(token, chatId, part)` вместо `sendMarkdown(token, chatId, part)`.
- `handleDocument` (upload-pipeline, ~line 411) не тронут — продолжает использовать `sendMarkdown` для детерминированного отчёта из `renderMarkdown(result)`.
- Обновлён комментарий в docstring `handleSummarizeCommand` (`→ sendMarkdown по частям` → `→ sendHtml по частям`) для консистентности.
- `npx tsc --noEmit` — чисто.

### Task 3: Тесты под HTML
- `src/__tests__/bot-summarize.test.ts`:
  - Тест переименован: `parse_mode=Markdown` → `parse_mode=HTML` в `it()` description.
  - Fixture: `"*Сводка*\n\nЗа период..."` → `"<b>Сводка</b>\n\nЗа период с 30 апреля по 8 мая лидирует Газпромнефть."`
  - Assert: `expect(narrative!.parse_mode).toBe("HTML")` (было `"Markdown"`).
- `src/__tests__/upload-llm.test.ts`:
  - В тесте «returns a single-part array when DeepSeek response is short» fixture `"*Сводка*\n\n..."` заменена на `"<b>Сводка</b>\n\n..."`. Assert `parts[0]).toContain("Газпромнефть")` продолжает работать.
  - Тест «chunks long responses» не трогал (fixture `"Газпромнефть продолжает доминировать. "` без markdown-маркеров — нейтрален к формату).
  - Тесты про `temperature=0`, `response_format=undefined`, `model` fallbacks, `DEEPSEEK_API_KEY` — формат-нейтральны, не тронуты.
- `npm test`: 137 files, **2601 tests passed**, 0 failed.

## Verification

- `npx tsc --noEmit` — без ошибок (проверено после каждого таска).
- `npm test` — 2601/2601 зелёные, время 2.82s.
- Ручная проверка (не блокер): следующий локальный запуск бота — пользователь должен увидеть narrative с жирными заголовками компаний (`<b>Газпромнефть</b>` → жирно отрендерится Telegram'ом), без `###`/`**`/`---` сырыми символами в чате.

## Deviations from Plan

None — план выполнен ровно как написан. Единственное «доп» — обновил один stale-комментарий в docstring `handleSummarizeCommand` («sendMarkdown по частям» → «sendHtml по частям»). Это не функциональное изменение, чисто документация для будущего читателя, попадает под Rule 2 (correctness-of-documentation) и закоммичено в Task 2.

## Commits

- `fdf26f4` — feat(quick-260519-tbo): rewrite NARRATIVE_SYSTEM_PROMPT for Telegram HTML
- `2581b34` — feat(quick-260519-tbo): add sendHtml and switch /summarize to HTML parse_mode
- `5f67c10` — test(quick-260519-tbo): update fixtures and assertions for Telegram HTML

## Self-Check: PASSED

- FOUND: src/upload/llm.ts (Telegram HTML prompt + header comment)
- FOUND: src/bot.ts (sendHtml helper + handleSummarizeCommand uses sendHtml)
- FOUND: src/__tests__/bot-summarize.test.ts (parse_mode=HTML assertion)
- FOUND: src/__tests__/upload-llm.test.ts (HTML fixture)
- FOUND commit: fdf26f4
- FOUND commit: 2581b34
- FOUND commit: 5f67c10
- npm test: 2601/2601 passed
- npx tsc --noEmit: clean
