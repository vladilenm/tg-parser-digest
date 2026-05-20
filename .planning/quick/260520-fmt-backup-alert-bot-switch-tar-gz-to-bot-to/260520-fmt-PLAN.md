---
phase: 260520-fmt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backup.ts
  - .env.example
autonomous: true
requirements:
  - QUICK-260520-fmt
must_haves:
  truths:
    - "src/backup.ts читает токен из BOT_TOKEN_ALERTS (а не TG_BOT_TOKEN) и chatId из ALERTS_CHAT_ID (а не TG_BACKUP_CHANNEL_ID/TG_CHANNEL_ID)"
    - "Если BOT_TOKEN_ALERTS или ALERTS_CHAT_ID не заданы — backupAndSend пишет log.warn и возвращается, tar.gz не отправляется (паттерн как в src/alert.ts:23-32)"
    - "Fallback на TG_BACKUP_CHANNEL_ID и TG_CHANNEL_ID полностью удалён из src/backup.ts"
    - ".env.example в блоке Alert-bot явно сообщает, что daily backup tar.gz также идёт через BOT_TOKEN_ALERTS в ALERTS_CHAT_ID"
    - "TypeScript строгая компиляция проходит, существующие тесты не падают"
  artifacts:
    - path: "src/backup.ts"
      provides: "Daily tar.gz backup отправляется через alert-бота в личку оператору"
      contains: "process.env.BOT_TOKEN_ALERTS"
    - path: ".env.example"
      provides: "Документация переменных окружения с обновлённым блоком про backup"
      contains: "backup"
  key_links:
    - from: "src/backup.ts:backupAndSend"
      to: "process.env.BOT_TOKEN_ALERTS / process.env.ALERTS_CHAT_ID"
      via: "direct env read"
      pattern: "BOT_TOKEN_ALERTS"
    - from: "src/backup.ts:backupAndSend"
      to: "tgSendDocument(token, chatId, archivePath, caption)"
      via: "internal call"
      pattern: "tgSendDocument\\("
---

<objective>
Переключить daily tar.gz backup в src/backup.ts с delivery-бота (TG_BOT_TOKEN + TG_CHANNEL_ID/TG_BACKUP_CHANNEL_ID) на alert-бота (BOT_TOKEN_ALERTS + ALERTS_CHAT_ID), чтобы архивы шли в личку оператору и не загрязняли публичный канал дайджеста.

Purpose: tar.gz больше не появляется в TG_CHANNEL_ID — канал остаётся чистым для дайджестов. Оператор продолжает получать ежедневные бэкапы, но уже в личке через alert-бота (тот же канал, что и pipeline-алёрты).
Output: обновлённый src/backup.ts (env vars + skip-pattern) + обновлённый .env.example (документация).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/backup.ts
@src/alert.ts
@.env.example

<interfaces>
<!-- Текущая сигнатура tgSendDocument в src/backup.ts (НЕ меняется) -->
```typescript
// src/backup.ts:30-55
async function tgSendDocument(
  token: string,
  chatId: string,
  filePath: string,
  caption: string
): Promise<void>
```

<!-- Паттерн skip-on-missing-env из src/alert.ts:20-33 — ОБРАЗЕЦ для backup.ts -->
```typescript
// src/alert.ts:20-33
export async function sendAlert(payload: AlertPayload): Promise<void> {
  const token = process.env.BOT_TOKEN_ALERTS;
  const chatId = process.env.ALERTS_CHAT_ID;
  if (!token || !chatId) {
    log.error(
      `[alert] BOT_TOKEN_ALERTS или ALERTS_CHAT_ID не задан — alert не отправлен. payload=...`
    );
    return;
  }
  // ...
}
```

<!-- Текущий блок в backup.ts, который нужно ЗАМЕНИТЬ (lines 112-120) -->
```typescript
const token = process.env.TG_BOT_TOKEN;
const chatId =
  process.env.TG_BACKUP_CHANNEL_ID || process.env.TG_CHANNEL_ID;
if (!token || !chatId) {
  log.warn(
    "[backup] TG_BOT_TOKEN or TG_BACKUP_CHANNEL_ID/TG_CHANNEL_ID not set — backup skipped"
  );
  return;
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Переключить backup.ts на BOT_TOKEN_ALERTS + ALERTS_CHAT_ID</name>
  <files>src/backup.ts</files>
  <action>
В функции `backupAndSend()` в src/backup.ts (строки 112-120):

1. Заменить чтение env-переменных:
   - Было: `const token = process.env.TG_BOT_TOKEN;`
     `const chatId = process.env.TG_BACKUP_CHANNEL_ID || process.env.TG_CHANNEL_ID;`
   - Стало: `const token = process.env.BOT_TOKEN_ALERTS;`
     `const chatId = process.env.ALERTS_CHAT_ID;`

2. Обновить guard-сообщение под новые переменные (паттерн строго как в src/alert.ts:23-32):
   - Было: `log.warn("[backup] TG_BOT_TOKEN or TG_BACKUP_CHANNEL_ID/TG_CHANNEL_ID not set — backup skipped");`
   - Стало: `log.warn("[backup] BOT_TOKEN_ALERTS или ALERTS_CHAT_ID не задан — backup skipped");`
   - Семантика: `if (!token || !chatId) { log.warn(...); return; }` — НЕ throw, НЕ log.error (это не критичная ошибка, это пропуск из-за неконфигурации; backup опционален, как и alert).

3. Fallback на `TG_BACKUP_CHANNEL_ID` и `TG_CHANNEL_ID` удалить полностью — ни в коде, ни в строке лога они больше не упоминаются.

4. Сигнатуру `tgSendDocument(token, chatId, archivePath, caption)` НЕ менять — она остаётся прежней, меняется только источник `token`/`chatId` в caller'е.

5. Caption (строка 122: `tg-parser-demo backup ${ymd}\nsize=${size}b sha256=${sha256}`) оставить как есть.

6. Лог успешной отправки (строка 124: `[backup] uploaded to chat=${chatId}`) оставить как есть — `chatId` теперь будет ALERTS_CHAT_ID, имя поля корректное.

7. Top-of-file комментарий (строки 1-9) можно оставить без изменений — он описывает механику (tar.gz + sendDocument), а не конкретного бота; ничто в нём не противоречит новой реализации.

Никаких других изменений в файле. Не трогать `tgSendDocument`, `pruneOldBackups`, `mskDateYmd`, `BACKUP_RETAIN`, импорты.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; npx tsc --noEmit &amp;&amp; ! grep -nE "TG_BOT_TOKEN|TG_BACKUP_CHANNEL_ID|TG_CHANNEL_ID" src/backup.ts &amp;&amp; grep -q "BOT_TOKEN_ALERTS" src/backup.ts &amp;&amp; grep -q "ALERTS_CHAT_ID" src/backup.ts</automated>
  </verify>
  <done>
- В src/backup.ts больше нет упоминаний `TG_BOT_TOKEN`, `TG_BACKUP_CHANNEL_ID`, `TG_CHANNEL_ID` (ни в коде, ни в строках логов).
- Присутствуют чтения `process.env.BOT_TOKEN_ALERTS` и `process.env.ALERTS_CHAT_ID`.
- Guard-блок повторяет паттерн src/alert.ts:23-32 — на missing env пишет log.warn и `return;`, не throw.
- `npx tsc --noEmit` проходит без ошибок.
  </done>
</task>

<task type="auto">
  <name>Task 2: Обновить .env.example — отметить, что backup идёт через alert-бота</name>
  <files>.env.example</files>
  <action>
В .env.example:

1. Проверить, что `TG_BACKUP_CHANNEL_ID` НЕ упоминается в файле (по предварительному анализу — отсутствует). Если вдруг есть — удалить строку с переменной и связанный комментарий. Если нет — пропустить шаг.

2. В блоке "Alert-bot (ALERT-01)" (строки 60-68) дополнить комментарий-заголовок (между `# -----------------` и `BOT_TOKEN_ALERTS=`), чтобы явно сказать, что эти же креды используются для daily backup. Конкретно — после строки `# Шлёт в личку владельца, НЕ загрязняет канал Заказчика.` добавить:

```
# Также используется для daily tar.gz backup (src/backup.ts, cron 03:15 MSK):
# архив config/+state/ уходит в ALERTS_CHAT_ID, чтобы не засорять TG_CHANNEL_ID.
```

3. В блоке "Telegram bot (доставка дайджеста в приватный канал)" (строки 17-22) комментарий к `TG_CHANNEL_ID` оставить как есть — этот канал теперь только для дайджеста, что соответствует исходному описанию.

4. Никаких других изменений: не трогать TG_API_ID/TG_API_HASH/TG_SESSION, DeepSeek-блок, параметры прогона, BOT_ALLOWED_USER_IDS.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; ! grep -q "TG_BACKUP_CHANNEL_ID" .env.example &amp;&amp; grep -q "BOT_TOKEN_ALERTS" .env.example &amp;&amp; grep -qi "backup" .env.example</automated>
  </verify>
  <done>
- В .env.example отсутствует переменная `TG_BACKUP_CHANNEL_ID`.
- В блоке alert-бота добавлена пояснительная строка о том, что daily tar.gz backup также идёт через BOT_TOKEN_ALERTS → ALERTS_CHAT_ID.
- `BOT_TOKEN_ALERTS` и `ALERTS_CHAT_ID` остаются объявленными (пустые значения).
  </done>
</task>

<task type="auto">
  <name>Task 3: Прогнать существующие тесты — убедиться, что ничего не сломалось</name>
  <files>(no files modified — verification only)</files>
  <action>
Запустить полный набор unit-тестов проекта, чтобы убедиться, что изменение env-переменных в backup.ts не задело смежный код (cron-обвязку в src/run.ts, логгер, paths). Если в проекте есть прямые тесты на backup — они должны зелёные; если нет — общий прогон достаточен.

Не модифицировать никаких файлов в этой задаче. Если тесты падают по нашим изменениям — починить причину в backup.ts/.env.example (не в тестах) или эскалировать.
  </action>
  <verify>
    <automated>cd /Users/vladilen/Documents/vscode/tg-parser-demo &amp;&amp; npm test --silent 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
- `npm test` завершается с зелёным статусом (exit code 0).
- Никаких новых упавших тестов по сравнению с baseline (`feac793` + последующие quick'и).
  </done>
</task>

</tasks>

<verification>
1. **Компиляция:** `npx tsc --noEmit` — без ошибок.
2. **Чистота кода:** в src/backup.ts нет ни одного упоминания `TG_BOT_TOKEN`, `TG_BACKUP_CHANNEL_ID`, `TG_CHANNEL_ID`.
3. **Новые env vars:** в src/backup.ts читаются `BOT_TOKEN_ALERTS` и `ALERTS_CHAT_ID`.
4. **Skip-pattern:** при `unset BOT_TOKEN_ALERTS` функция `backupAndSend()` пишет log.warn и тихо возвращается, не throw'ит.
5. **.env.example:** актуализирован — alert-бот блок упоминает backup, `TG_BACKUP_CHANNEL_ID` отсутствует.
6. **Тесты:** `npm test` зелёный.
</verification>

<success_criteria>
- При штатном запуске (`npm start` в daemon-режиме или прямой вызов backup) при заданных `BOT_TOKEN_ALERTS`+`ALERTS_CHAT_ID` tar.gz архив приходит в личку оператору через alert-бота.
- В канале дайджеста (`TG_CHANNEL_ID`) tar.gz архивы больше не появляются — никаких code paths из backup.ts в этот канал не ведёт.
- При неконфигурированных alert-кредах backup тихо пропускается с log.warn, daemon продолжает работать.
- Существующие тесты зелёные.
</success_criteria>

<output>
After completion, create `.planning/quick/260520-fmt-backup-alert-bot-switch-tar-gz-to-bot-to/260520-fmt-SUMMARY.md`
</output>
