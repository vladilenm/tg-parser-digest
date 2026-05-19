---
phase: quick-260519-tmc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/web-scraper.ts
  - src/__tests__/web-scraper.test.ts
autonomous: true
requirements:
  - QUICK-260519-TMC-01
must_haves:
  truths:
    - "Блок «⚠️ Не удалось распарсить (N)» в web-дайджесте показывает только URL, без причины ошибки."
    - "Заголовок блока, счётчик (N), HTML-escape URL и поведение на пустом массиве сохранены."
    - "`npm test` зелёный — все тесты buildFailedSitesBlock соответствуют новому формату."
  artifacts:
    - path: "src/web-scraper.ts"
      provides: "buildFailedSitesBlock рендерит строку `• <code>${escapeHtml(url)}</code>` без `— reason`. REASON_MAX_CHARS удалён."
      contains: "export function buildFailedSitesBlock"
    - path: "src/__tests__/web-scraper.test.ts"
      provides: "Юнит-тесты buildFailedSitesBlock обновлены: убран — reason, удалён тест D (reason length cap), тест C проверяет только escape URL."
      contains: "describe(\"buildFailedSitesBlock"
  key_links:
    - from: "src/web-scraper.ts::buildFailedSitesBlock"
      to: "runWebPipeline (caller, ~line 445)"
      via: "сигнатура `Array<{ url: string; reason: string }>` сохранена — caller не трогаем, reason всё ещё собирается для логов."
      pattern: "failedSites\\.push"
---

<objective>
Убрать рендер причины ошибки из блока «⚠️ Не удалось распарсить» в web-дайджесте — оставить только URL. Reason всё ещё попадает в failedSites (для логов/дебага), просто не отображается в Telegram-сообщении.

Purpose: Заказчик попросил почистить визуальный шум в дайджесте — длинные технические причины (UND_ERR_CONNECT_TIMEOUT, fetch failed cause-цепочки) занимают место и не нужны конечному читателю. URL достаточно, чтобы понять, какие источники выпали.

Output: один edit в src/web-scraper.ts (buildFailedSitesBlock + удаление REASON_MAX_CHARS) + синхронизация юнит-тестов в src/__tests__/web-scraper.test.ts.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@src/web-scraper.ts
@src/__tests__/web-scraper.test.ts

<interfaces>
<!-- Текущий контракт buildFailedSitesBlock (src/web-scraper.ts:327-340) — то, что меняем. -->
<!-- Сигнатура остаётся той же, меняется только формат вывода. -->

Current (src/web-scraper.ts:327-340):
```typescript
const REASON_MAX_CHARS = 120;
export function buildFailedSitesBlock(
  failedSites: Array<{ url: string; reason: string }>
): string {
  if (failedSites.length === 0) return "";
  const lines = failedSites.map((f) => {
    const reason =
      f.reason.length > REASON_MAX_CHARS
        ? f.reason.slice(0, REASON_MAX_CHARS) + "…"
        : f.reason;
    return `• <code>${escapeHtml(f.url)}</code> — ${escapeHtml(reason)}`;
  });
  return `\n\n<b>⚠️ Не удалось распарсить (${failedSites.length})</b>\n` + lines.join("\n");
}
```

Caller (src/web-scraper.ts:445, runWebPipeline) — НЕ трогаем:
```typescript
const msg = formatErrCause(r.reason);
failedSites.push({ url: site.url, reason: msg }); // quick-260519-k6c
```
Reason всё ещё собирается и (в других местах) логируется — мы только убираем его из рендера блока.

Target (после изменения):
```typescript
export function buildFailedSitesBlock(
  failedSites: Array<{ url: string; reason: string }>
): string {
  if (failedSites.length === 0) return "";
  const lines = failedSites.map((f) => `• <code>${escapeHtml(f.url)}</code>`);
  return `\n\n<b>⚠️ Не удалось распарсить (${failedSites.length})</b>\n` + lines.join("\n");
}
```
Сигнатура та же (reason остаётся в типе массива — runWebPipeline продолжает её передавать). REASON_MAX_CHARS удалён.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Обновить тесты buildFailedSitesBlock (RED) и упростить рендер (GREEN)</name>
  <files>src/__tests__/web-scraper.test.ts, src/web-scraper.ts</files>
  <behavior>
    Цель: блок «⚠️ Не удалось распарсить (N)» рендерит только URL (без причины).

    Tests (обновляем существующий describe «buildFailedSitesBlock (quick-260519-k6c)»):
    - Test A (non-empty) — assert новый формат:
      • result.startsWith("\n\n") === true
      • result содержит `<b>⚠️ Не удалось распарсить (2)</b>`
      • result содержит `• <code>https://a.example/</code>` (БЕЗ ` — HTTP 500`)
      • result содержит `• <code>https://b.example/news</code>` (БЕЗ ` — fetch failed`)
      • result содержит `(${failedSites.length})`
      • result НЕ содержит `— HTTP 500` (новое expect — гарантия что reason не утёк)
      • result НЕ содержит `— fetch failed`
    - Test B (empty input) — без изменений: buildFailedSitesBlock([]) === "".
    - Test C (HTML escape) — упростить:
      • Оставить проверку escape URL (`&` → `&amp;`, `&b=2` не сырой).
      • УДАЛИТЬ assertions на escape reason (`<script>` уже не рендерится).
      • Можно оставить fixture с `reason: "<script>alert(1)</script>"` — это эмулирует продакшен (reason приходит, но не используется), и добавить assert `expect(result).not.toContain("<script>")` и `expect(result).not.toContain("&lt;script&gt;")` — гарантирует, что reason нигде не утёк (ни сырым, ни escaped).
    - Test D (reason length cap) — УДАЛИТЬ полностью (REASON_MAX_CHARS больше нет).

    После того как тесты обновлены — они должны падать на текущей реализации (RED). Затем правим src/web-scraper.ts → GREEN.
  </behavior>
  <action>
    Шаг 1 — RED: обновить src/__tests__/web-scraper.test.ts (строки 293-348):
      a) Test A («non-empty — возвращает блок с заголовком и bullets»):
         - Заменить `expect(result).toContain("• <code>https://a.example/</code> — HTTP 500");` на `expect(result).toContain("• <code>https://a.example/</code>");`
         - Заменить `expect(result).toContain("• <code>https://b.example/news</code> — fetch failed");` на `expect(result).toContain("• <code>https://b.example/news</code>");`
         - Добавить две негативные assertions: `expect(result).not.toContain("— HTTP 500");` и `expect(result).not.toContain("— fetch failed");`
      b) Test C («HTML escape — url и reason экранируются» → переименовать в «HTML escape — url экранируется, reason не рендерится»):
         - Оставить fixture как есть (url с `&`, reason с `<script>`).
         - Оставить `expect(result).toContain("&amp;");` и `expect(result).not.toContain("&b=2");` (escape URL — работает).
         - УДАЛИТЬ `expect(result).toContain("&lt;script&gt;");`.
         - ОСТАВИТЬ `expect(result).not.toContain("<script>");` (страховка: сырой <script> не утёк).
         - ДОБАВИТЬ `expect(result).not.toContain("&lt;script&gt;");` (страховка: escaped reason тоже не утёк — его вообще нет в выводе).
      c) Test D («reason length cap») — УДАЛИТЬ весь it-блок (строки 336-347).

    Шаг 2 — verify RED: запустить `npm test -- src/__tests__/web-scraper.test.ts` — тесты A и C должны падать на текущей реализации (она рендерит `— reason`). Тест D после удаления просто не запускается.

    Шаг 3 — GREEN: обновить src/web-scraper.ts (строки 327-340):
      - Удалить строку 327: `const REASON_MAX_CHARS = 120;`
      - Внутри `.map((f) => { ... })` упростить до однострочника: `(f) => \`• <code>${escapeHtml(f.url)}</code>\``
      - Удалить локальную переменную `reason` и тернарник с truncation.
      - Сигнатуру `Array<{ url: string; reason: string }>` НЕ менять (caller в runWebPipeline продолжает передавать reason — он используется для логов в другом месте).
      - Комментарии (`// quick-260519-k6c`, header-блок) — оставить как есть; можно добавить пометку `// quick-260519-tmc: reason больше не рендерится, остаётся только в типе для совместимости`.

    Шаг 4 — verify GREEN:
      - `npm test` — все тесты зелёные (включая 4 теста buildFailedSitesBlock: A, B, C; D удалён).
      - `npx tsc --noEmit` — проверка типов проходит (никаких dangling references на REASON_MAX_CHARS).

    Шаг 5 — sanity grep: `grep -rn "REASON_MAX_CHARS" src/` — должен ничего не выдать.

    Out of scope (не трогать):
    - runWebPipeline (src/web-scraper.ts:~445) — failedSites.push с reason остаётся как есть.
    - formatErrCause и логику populate failedSites выше по стеку.
    - sendHtml / composeWebDigest / buildWebHeader / buildPlaceholderHtml.
    - Markdown upload-pipeline (handleDocument в bot.ts).
    - console.log / logger.warn, которые печатают reason в лог-файл — должны продолжать работать.
  </action>
  <verify>
    <automated>npm test -- src/__tests__/web-scraper.test.ts && npx tsc --noEmit && ! grep -rn "REASON_MAX_CHARS" src/</automated>
  </verify>
  <done>
    - src/web-scraper.ts: REASON_MAX_CHARS удалён, buildFailedSitesBlock рендерит `• <code>${escapeHtml(f.url)}</code>` без ` — reason`. Сигнатура функции (тип параметра) не изменилась.
    - src/__tests__/web-scraper.test.ts: тест A и C обновлены под новый формат + добавлены негативные assertions «reason нигде не утёк»; тест D (reason length cap) удалён; тест B (empty) без изменений.
    - `npm test` — все тесты проекта зелёные.
    - `npx tsc --noEmit` — без ошибок типов.
    - `grep -rn "REASON_MAX_CHARS" src/` — пусто.
    - Smoke (визуально, опционально): запустить `npm run start:once:web` в dev-окружении и убедиться, что блок «⚠️ Не удалось распарсить» в TG-сообщении содержит только URL. (Не обязательно для merge — автотестов достаточно.)
  </done>
</task>

</tasks>

<verification>
- Юнит-тесты buildFailedSitesBlock покрывают новый формат (URL-only) и явно проверяют отсутствие reason в выводе.
- TypeScript-чек проходит — нет dangling references на удалённую константу.
- Caller-контракт (runWebPipeline → failedSites.push с reason) не сломан: тип параметра функции сохранён.
- Регрессионная проверка: остальные ~2600 тестов проекта остаются зелёными.
</verification>

<success_criteria>
- Блок «⚠️ Не удалось распарсить (N)» в web-дайджесте показывает только список URL без причин ошибок.
- Сигнатура buildFailedSitesBlock не сломана для caller'ов.
- `npm test` зелёный, `npx tsc --noEmit` без ошибок.
- В коде нет упоминаний REASON_MAX_CHARS.
- Reason всё ещё доступен в failedSites для логов/дебага (не отрезан upstream).
</success_criteria>

<output>
After completion, create `.planning/quick/260519-tmc-url/260519-tmc-SUMMARY.md` следуя стандартному шаблону SUMMARY.
</output>
