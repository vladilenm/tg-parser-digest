---
phase: 03-web-scraping
plan: 03
type: execute
wave: 3
depends_on:
  - 03-02
files_modified:
  - src/pipeline.ts
  - src/run.ts
  - src/logger.ts
autonomous: true
requirements:
  - WEB-01
  - WEB-02
  - WEB-03
tags:
  - integration
  - daemon
  - alerts

must_haves:
  truths:
    - "runPipeline принимает runId как параметр (не генерирует внутри)"
    - "tick() генерирует один runId и прокидывает в runPipeline и runWebPipeline"
    - "TG-pipeline и web-pipeline вызываются в РАЗДЕЛЬНЫХ try/catch внутри tick()"
    - "Web-pipeline запускается даже если TG-pipeline упал (D-08)"
    - "Web-failure отправляет sendAlert(stage:'web', ...)"
    - "TG-failure отправляет sendAlert(stage:'tick', ...) (без изменений)"
    - "logRunSummary продолжает работать для TG; logWebRunSummary логирует web"
  artifacts:
    - path: "src/pipeline.ts"
      provides: "runPipeline(runId) — refactored signature"
      contains: "runPipeline(runId: string)"
    - path: "src/run.ts"
      provides: "tick() with two independent try/catch blocks"
      contains: "runWebPipeline"
    - path: "src/logger.ts"
      provides: "logWebRunSummary helper"
      exports: ["logWebRunSummary"]
  key_links:
    - from: "src/run.ts (tick)"
      to: "src/pipeline.ts (runPipeline)"
      via: "await runPipeline(runId) inside try/catch #1"
      pattern: "await runPipeline\\(runId\\)"
    - from: "src/run.ts (tick)"
      to: "src/web-scraper.ts (runWebPipeline)"
      via: "await runWebPipeline(runId) inside try/catch #2 (independent)"
      pattern: "await runWebPipeline\\(runId\\)"
    - from: "src/run.ts catch #2"
      to: "src/alert.ts (sendAlert)"
      via: 'stage: "web"'
      pattern: 'stage:\\s*"web"'
---

<objective>
Интегрировать `runWebPipeline` (Plan 02) в daemon-tick (D-06..D-09):
1) Рефакторинг `src/pipeline.ts` — `runPipeline()` принимает `runId` параметром (D-07);
2) Рефакторинг `src/run.ts` `tick()` — генерирует единый `runId`, прокидывает в обе функции,
   делит существующий try/catch на два независимых блока (D-08), второй catch шлёт
   `sendAlert(stage:"web", ...)` (D-09);
3) Расширение `src/logger.ts` — добавить `logWebRunSummary` для красивого вывода `WebRunSummary`.

Purpose: web-pipeline доставляет свою сводку независимо от TG-pipeline. Если TG упал —
web всё равно стартует. Один общий `runId` позволяет оператору фильтровать логи одной grep-командой.

Output: рефакторенный `pipeline.ts`, расширенный `run.ts` с двумя try/catch, расширенный `logger.ts`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-web-scraping/03-CONTEXT.md
@.planning/phases/02-bot-commands/02-CONTEXT.md
@CLAUDE.md
@src/pipeline.ts
@src/run.ts
@src/logger.ts
@src/web-scraper.ts
@src/alert.ts
@src/types.ts

<interfaces>
<!-- Существующие сигнатуры, которые мы рефакторим / используем. -->

From src/pipeline.ts (existing — current signature):
```typescript
export async function runPipeline(): Promise<RunSummary>;
// Текущая реализация генерирует runId внутри (line 21).
// После рефактора: export async function runPipeline(runId: string): Promise<RunSummary>;
```

From src/web-scraper.ts (Plan 02 — already exists):
```typescript
export async function runWebPipeline(runId: string): Promise<WebRunSummary>;
```

From src/run.ts (existing tick — будет переписан):
```typescript
async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
    await new Promise((r) => setTimeout(r, jitterMs));
    const summary = await runPipeline();
    logRunSummary(summary);
  } catch (err) {
    // existing single catch — sendAlert(stage:"tick"), генерит alertId через crypto.randomUUID().slice(0,8)
  } finally {
    isRunning = false;
  }
}
// ВАЖНО: bot-supervisor (lines 63-81) тоже использует `const alertId = crypto.randomUUID().slice(0, 8);`.
// После рефактора tick'а: ОДНО `const runId = crypto.randomUUID().slice(0, 8);` в tick (D-07),
// `alertId` в bot-supervisor НЕ ТРОГАЕМ (имя/семантика разные — это идентификатор алерта, не runId прогона).
```

From src/alert.ts (existing — used as-is):
```typescript
export interface AlertPayload { stage: string; message: string; runId: string; stack?: string; }
export async function sendAlert(payload: AlertPayload): Promise<void>;
```

From src/types.ts (Plan 01 — extended):
```typescript
export interface RunSummary { /* TG-сводка */ }
export interface WebRunSummary { /* web-сводка */ }
```

From src/logger.ts (existing — extend):
```typescript
export const log = { info, warn, error };
export function logRunSummary(s: RunSummary): void;
// New (Task 3): export function logWebRunSummary(s: WebRunSummary): void;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Рефакторинг src/pipeline.ts — runPipeline принимает runId параметром (D-07)</name>
  <files>src/pipeline.ts</files>
  <behavior>
    - Test 1 (existing tests должны продолжать работать): `npx vitest run` зелёный после рефактора
    - Test 2: `runPipeline.length === 1` (один required-параметр)
    - Test 3: `runPipeline("abc12345")` использует переданный runId, не генерирует свой
  </behavior>
  <read_first>
    - src/pipeline.ts (полный файл — line 20-21 содержит `crypto.randomUUID().slice(0,8)`, который удаляется)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-07: «runId генерируется в tick(), прокидывается параметром»)
    - src/__tests__/ (проверить, есть ли тесты на pipeline; если есть — они не должны сломаться; вероятно нет)
  </read_first>
  <action>
1) Открыть `src/pipeline.ts`. Изменить сигнатуру `runPipeline()` на `runPipeline(runId)`:

ДО (line 20):
```typescript
export async function runPipeline(): Promise<RunSummary> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
```

ПОСЛЕ:
```typescript
export async function runPipeline(runId: string): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
```

То есть:
- Добавить `runId: string` в сигнатуру.
- УДАЛИТЬ строку `const runId = crypto.randomUUID().slice(0, 8);` (line 21).
- Все остальные использования `runId` в файле остаются неизменными.

2) Запустить `npx tsc --noEmit` — будет ошибка в `src/run.ts` (вызов `runPipeline()` без аргумента). Это ожидаемо, исправим в Task 2.

3) Запустить vitest для существующих тестов: `npx vitest run src/__tests__/summarize.test.ts src/__tests__/channels-store.test.ts src/__tests__/bot-handlers.test.ts src/__tests__/archive-web.test.ts` — все эти тесты НЕ зависят от runPipeline, должны быть зелёными.

Не трогать остальную логику pipeline.ts (channels.shuffle, fetchLast24h, dedup, summarize, sendToChannel, writeRaw/writeOutput, returns).
  </action>
  <acceptance_criteria>
    - `grep -E '^export async function runPipeline\(runId: string\): Promise<RunSummary>' src/pipeline.ts` (новая сигнатура)
    - `! grep -E "const runId = crypto\.randomUUID\(\)\.slice\(0, 8\);" src/pipeline.ts` (старая генерация удалена)
    - `grep -c '\brunId\b' src/pipeline.ts` >= 4 (runId всё ещё используется в логах + writeRaw + summary.runId + return)
    - `npx vitest run src/__tests__/summarize.test.ts src/__tests__/channels-store.test.ts src/__tests__/bot-handlers.test.ts src/__tests__/archive-web.test.ts` (все зелёные — рефактор не задел чужие модули)
    - Существующая логика shuffle, dedup, summarize цела: `grep -E "Fisher-Yates|writeRaw|dedupAgainstCache|sendToChannel" src/pipeline.ts` находит каждое
  </acceptance_criteria>
  <verify>
    <automated>npx vitest run src/__tests__/summarize.test.ts src/__tests__/channels-store.test.ts src/__tests__/bot-handlers.test.ts src/__tests__/archive-web.test.ts</automated>
  </verify>
  <done>
    `runPipeline(runId: string)` — сигнатура с одним required параметром. Внутренняя генерация `crypto.randomUUID()` удалена. Все существующие vitest-тесты зелёные. `npx tsc --noEmit` показывает только ожидаемую ошибку в `src/run.ts` (Task 2 fix).
  </done>
</task>

<task type="auto">
  <name>Task 2: Рефакторинг src/run.ts — два независимых try/catch для TG и web (D-06..D-09)</name>
  <files>src/run.ts</files>
  <read_first>
    - src/run.ts (полный файл — lines 14-48 tick() будет переписан; ВАЖНО: bot-supervisor lines 63-81 использует `const alertId = crypto.randomUUID().slice(0, 8);` — НЕ ТРОГАТЬ)
    - src/pipeline.ts (новая сигнатура из Task 1: `runPipeline(runId)`)
    - src/web-scraper.ts (Plan 02: `runWebPipeline(runId)`)
    - src/alert.ts (sendAlert + AlertPayload, stage уже string)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (D-06 entrypoint, D-07 shared runId, D-08 independent try/catch, D-09 stage="web")
    - .planning/phases/02-bot-commands/02-CONTEXT.md (паттерн tick() catch + sendAlert)
  </read_first>
  <action>
Полностью переписать функцию `tick()` в `src/run.ts` (lines 14-48). Не трогать импорты, top-level cron-bootstrap, bot-supervisor (lines 50-104). Не трогать `shutdown()`. **bot-supervisor имеет свой `const alertId = crypto.randomUUID().slice(0, 8);` (line 69) — оставляем как есть, имя `alertId` отражает «идентификатор алерта», не runId прогона.**

1) Добавить импорт `runWebPipeline` (после существующего импорта `runPipeline`):

ДО (lines 5-9):
```typescript
import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { log, logRunSummary } from "./logger.js";
import { sendAlert } from "./alert.js";
import { startBot, stopBot, isBotPolling } from "./bot.js";
```

ПОСЛЕ:
```typescript
import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { runWebPipeline } from "./web-scraper.js";
import { log, logRunSummary, logWebRunSummary } from "./logger.js";
import { sendAlert } from "./alert.js";
import { startBot, stopBot, isBotPolling } from "./bot.js";
```

(`logWebRunSummary` будет добавлен в Task 3.)

2) Переписать `tick()` (lines 14-48) — две независимые try/catch секции, общий `runId`. Существующий tick имел `alertId = crypto.randomUUID().slice(0,8)` внутри catch (line 33) — заменяем его на использование общего `runId`, объявленного НА ВЕРХУ tick'а:

```typescript
async function tick(): Promise<void> {
  if (isRunning) {
    log.warn("prev run still in progress — skipping tick");
    return;
  }
  isRunning = true;
  // D-07: единый runId на tick — TG и web фильтруются одним grep'ом.
  const runId = crypto.randomUUID().slice(0, 8);
  try {
    // ANTIBAN: рандомная пауза 0–30 минут перед прогоном.
    const jitterMs = Math.floor(Math.random() * 30 * 60 * 1000);
    log.info(`[tick] runId=${runId} schedule jitter: sleeping ${(jitterMs / 1000).toFixed(0)}s before run`);
    await new Promise((r) => setTimeout(r, jitterMs));

    // ---- D-06: TG-pipeline (existing, unchanged behavior) ----
    try {
      const summary = await runPipeline(runId);
      logRunSummary(summary);
    } catch (err) {
      const e = err as Error;
      log.error(`[tick] runId=${runId} TG pipeline failed`, e);
      // ALERT-02 (D-13): await — гарантируем 60s окно.
      try {
        await sendAlert({
          stage: "tick",
          message: e?.message ?? String(err),
          runId,
          stack: e?.stack,
        });
      } catch (alertErr) {
        log.error("alert send failed", alertErr);
      }
    }

    // ---- D-08: Web-pipeline стартует НЕЗАВИСИМО от TG (даже если TG упал) ----
    try {
      const webSummary = await runWebPipeline(runId);
      logWebRunSummary(webSummary);
    } catch (err) {
      // D-09: alert stage="web" — оператор сразу различает TG vs web fail.
      const e = err as Error;
      log.error(`[tick] runId=${runId} web pipeline failed`, e);
      try {
        await sendAlert({
          stage: "web",
          message: e?.message ?? String(err),
          runId,
          stack: e?.stack,
        });
      } catch (alertErr) {
        log.error("alert send failed", alertErr);
      }
    }
  } finally {
    isRunning = false;
  }
}
```

**Критично:** старый `const alertId = crypto.randomUUID().slice(0, 8);` (line 33 ИЗ tick'а, который мы переписываем) — УДАЛЯЕТСЯ. Вместо `runId: alertId` в payload — теперь `runId` (общий из tick'а). НО bot-supervisor (lines 63-81 оригинала) сохраняет свой `const alertId = crypto.randomUUID().slice(0, 8);` (line 69) и `runId: alertId` в payload — bot-supervisor имеет отдельную семантику (он не часть pipeline-tick'а), его alertId это просто id текущего алерта, не runId прогона.

3) Запустить `npx tsc --noEmit` — должен быть чистый (после Task 1 + Task 2 + Task 3 импорта `logWebRunSummary` если он уже добавлен; если Task 3 ещё не сделан — будет ошибка отсутствующего экспорта; это OK, в Task 3 фиксится).

Если порядок задач: Task 3 ДО Task 2 — Task 2 финиширует с чистым tsc. Если Task 2 ДО Task 3 — Task 2 оставляет ошибку, фиксится в Task 3. Executor вправе выбрать порядок Task 2 ↔ Task 3.
  </action>
  <acceptance_criteria>
    - `grep -E '^import \{ runWebPipeline \} from "\./web-scraper\.js"' src/run.ts` (новый импорт)
    - `grep -E '^import \{ log, logRunSummary, logWebRunSummary \} from "\./logger\.js"' src/run.ts` (расширенный импорт)
    - `grep -F 'const runId = crypto.randomUUID().slice(0, 8);' src/run.ts | wc -l` возвращает `1` (ровно одно вхождение `const runId = ...` в tick — D-07; bot-supervisor использует `alertId`, не `runId`)
    - `grep -F 'const alertId = crypto.randomUUID().slice(0, 8);' src/run.ts | wc -l` возвращает `1` (ровно одно вхождение `alertId` — в bot-supervisor; в tick старый `alertId` удалён, заменён общим `runId`)
    - `grep -c 'crypto.randomUUID().slice(0, 8)' src/run.ts` возвращает `2` (одно `const runId` в tick + одно `const alertId` в bot-supervisor)
    - `grep -E 'await runPipeline\(runId\)' src/run.ts` (TG зов)
    - `grep -E 'await runWebPipeline\(runId\)' src/run.ts` (web зов — D-06)
    - `grep -c 'try {' src/run.ts` >= 4 (tick outer, TG inner, web inner, bot supervisor — каждый плюс свои inner catch для sendAlert)
    - `grep -F 'stage: "tick"' src/run.ts` (TG fail)
    - `grep -F 'stage: "web"' src/run.ts` (D-09 web fail)
    - `grep -F 'stage: "bot"' src/run.ts` (bot-supervisor alert — НЕ задет рефактором, остаётся как было)
    - `grep -E "logWebRunSummary\(webSummary\)" src/run.ts` (web summary логирование)
    - `grep -E "Web-pipeline стартует НЕЗАВИСИМО|D-08" src/run.ts` (комментарий с decision-id для traceability)
    - Bot supervisor код (lines 63-81 из оригинала) не задет: `grep -F 'startBot()' src/run.ts` находит вхождение
    - `shutdown()` функция не изменена: `grep -F "process.on(\"SIGINT\"" src/run.ts` (статус 0)
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    `tick()` содержит два independent try/catch, один общий `runId`, TG зов через `runPipeline(runId)`, web зов через `runWebPipeline(runId)`. Web стартует даже если TG упал (D-08). Web-fail алертит `stage:"web"` (D-09). Bot-supervisor `alertId` не тронут. `npx tsc --noEmit` чистый (после Task 3).
  </done>
</task>

<task type="auto">
  <name>Task 3: Расширить src/logger.ts функцией logWebRunSummary</name>
  <files>src/logger.ts</files>
  <read_first>
    - src/logger.ts (полный файл — образец logRunSummary, lines 27-43)
    - src/types.ts (WebRunSummary интерфейс, добавлен в Plan 01 Task 2)
    - .planning/phases/03-web-scraping/03-CONTEXT.md (Claude's Discretion §«WebRunSummary тип»)
  </read_first>
  <action>
В `src/logger.ts` сделать две правки:

1) Расширить импорт типов (line 5):
ДО:
```typescript
import type { RunSummary } from "./types.js";
```
ПОСЛЕ:
```typescript
import type { RunSummary, WebRunSummary } from "./types.js";
```

2) В КОНЕЦ файла (после `logRunSummary`) добавить:

```typescript
/**
 * Phase 3: печатает многострочный summary-блок для WebRunSummary.
 * Параллельный аналог logRunSummary, отдельно — чтобы оператор различал TG vs web в логах.
 */
export function logWebRunSummary(s: WebRunSummary): void {
  const dur = (s.durationMs / 1000).toFixed(1);
  const lines = [
    `[${s.finishedAt}] [web-summary] runId=${s.runId}`,
    `  duration=${dur}s`,
    `  websites: total=${s.websitesTotal} succeeded=${s.websitesSucceeded} skipped=${s.websitesSkipped}`,
    `  items: collected=${s.itemsCollected} dropped=${s.itemsDropped}`,
    `  delivered=${s.digestDelivered}`,
  ];
  if (s.errors.length > 0) {
    lines.push("  errors:");
    for (const e of s.errors) {
      lines.push(`    - ${e}`);
    }
  }
  console.log(lines.join("\n"));
}
```

3) Запустить `npx tsc --noEmit` — после Task 1, 2, 3 должен быть полностью чистый.

4) Запустить весь vitest: `npx vitest run` — все существующие тесты + Plan 01 Task 3 (archive-web.test.ts) должны быть зелёными.
  </action>
  <acceptance_criteria>
    - `grep -E "^import type \{ RunSummary, WebRunSummary \} from" src/logger.ts` (расширенный импорт)
    - `grep -E "^export function logWebRunSummary\(s: WebRunSummary\): void" src/logger.ts` (точная сигнатура)
    - `grep -F '[web-summary]' src/logger.ts` (отдельный prefix для отличия от TG `[summary]`)
    - `grep -E "websites: total=\$\{s\.websitesTotal\}" src/logger.ts` (поле total логируется)
    - `grep -E "items: collected=" src/logger.ts` (поле items логируется)
    - `grep -F "delivered=${s.digestDelivered}" src/logger.ts` (поле delivered логируется)
    - Существующая `logRunSummary` не задета: `grep -E "^export function logRunSummary\(s: RunSummary\): void" src/logger.ts` (статус 0)
    - `npx tsc --noEmit` (статус 0 — Task 1+2+3 stack чистый)
    - `npx vitest run` (все тесты зелёные)
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run</automated>
  </verify>
  <done>
    `logWebRunSummary` экспортирована из `src/logger.ts`, формат симметричен `logRunSummary` с префиксом `[web-summary]`. `npx tsc --noEmit` чистый, все существующие vitest-тесты зелёные.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TG-pipeline error → web-pipeline launch | Один failure mode не должен блокировать другой (D-08) |
| TG runId → web runId | Один runId шарится между двумя pipeline'ами — потенциал log-confusion |
| sendAlert(stage:"web") → ALERTS_CHAT_ID | Web-error метаданные (URL?) попадают в alert-chat оператора |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-09 | Denial of Service (cascading failure) | tick() outer catch | mitigate | TG и web обёрнуты в раздельные try/catch (D-08); пробитие одного не убивает другой. Outer try — только для jitter / unexpected errors |
| T-03-10 | Information Disclosure через alerts | sendAlert payload | mitigate | `AlertPayload` сериализует только `{stage, message, runId, stack}` (см. src/alert.ts T-01-02). `process.env` не входит в payload. Alert идёт в ALERTS_CHAT_ID — личка оператора, не публичный канал |
| T-03-11 | Repudiation (kто инициировал run) | runId trace | mitigate | Один `runId` на tick (D-07): grep по `runId=abc12345` в pm2 logs покажет ВСЕ события prgona (TG + web + alerts). Отсутствие двойной генерации устраняет ambiguity |
| T-03-12 | Race condition (concurrent tick) | isRunning mutex | accept | Существующий `let isRunning = false` (run.ts:12) защищает от cron-race. Phase 3 не вводит нового state'а — изменение поведения только внутри одного tick'а |
</threat_model>

<verification>
1. `npx tsc --noEmit` чистый.
2. `npx vitest run` — все существующие тесты зелёные (рефактор не сломал ни один).
3. `grep -c 'await runPipeline' src/run.ts` == 1, `grep -c 'await runWebPipeline' src/run.ts` == 1.
4. Тот же `runId` используется в обоих вызовах: `grep -A1 'crypto.randomUUID().slice(0, 8)' src/run.ts | head -3` показывает const-объявление в `tick()`.
5. Web-failure алертит `stage:"web"`, TG-failure — `stage:"tick"`.
6. `logWebRunSummary` экспортирована и принимает `WebRunSummary`.
</verification>

<success_criteria>
- `runPipeline(runId)` — сигнатура с одним required параметром, внутренняя генерация удалена
- `tick()` содержит два independent try/catch блока для TG и web (D-08)
- Один `runId` шарится между обоими вызовами (D-07)
- Web-fail отправляет `sendAlert(stage:"web", runId, message, stack)` (D-09)
- `logWebRunSummary` логирует web-summary с префиксом `[web-summary]`
- `npx tsc --noEmit` и `npx vitest run` оба зелёные
- bot-supervisor (lines 63-81 из оригинала run.ts) и `shutdown()` остались без изменений
</success_criteria>

<output>
After completion, create `.planning/phases/03-web-scraping/03-03-SUMMARY.md`.
</output>
