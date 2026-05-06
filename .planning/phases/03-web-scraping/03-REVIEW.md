---
phase: 03-web-scraping
reviewed: 2026-05-06T19:30:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - README.md
  - package-lock.json
  - package.json
  - scripts/run-once.ts
  - src/__tests__/archive-web.test.ts
  - src/__tests__/web-scraper.test.ts
  - src/archive.ts
  - src/logger.ts
  - src/pipeline.ts
  - src/run.ts
  - src/schema.ts
  - src/types.ts
  - src/web-scraper.ts
  - websites.json
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 3: Code Review Report (Re-review after auto-fix)

**Reviewed:** 2026-05-06T19:30:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found (minor)

## Summary

Re-review подтверждает: auto-fix pass корректно закрыл **CR-01 (SSRF)** и все 9 warnings
из первого review. Шесть исправляющих коммитов (`22c9adc`, `84fcc3c`, `434f99a`, `c7ed0ba`,
`0e14a96`, `a23613b`) применены аккуратно, без широких регрессий.

**Что верифицировано как закрытое:**

- **CR-01 (SSRF)** — закрыто двумя слоями: `WebsiteEntrySchema` теперь применяет `isSafePublicUrl`
  refinement (`schema.ts:70-104`) с denylist privatе-network/loopback/link-local hostname'ов;
  `fetchSite` использует `redirect: "manual"` + ручную revalidation `Location` через
  `isSafePublicUrl` на каждом hop'е (`web-scraper.ts:58-101`), с лимитом `MAX_REDIRECT_HOPS=5`.
  WR-07 (open-redirect chain) — той же change.
- **WR-01** — `activeAbort: AbortController` хранится module-level (`run.ts:18`),
  `abortableSleep()` корректно abort'ит timer и снимает listener (`run.ts:111-127`),
  `shutdown()` вызывает `activeAbort?.abort()` (`run.ts:168`), tick распознаёт
  `e.message === "shutdown"` и тихо `return`'ит (`run.ts:39-42`).
- **WR-02 / WR-03 / WR-06** — README §2 синхронизирован с `package.json` (5 dep'ов,
  включая `cheerio`); `channels.yaml` → `channels.json` везде; пример `[summary]` log'а
  теперь содержит `dropped=K` с описанием.
- **WR-04** — `summarize()` возвращает структурированный `{ html, postsDropped, itemsCount }`
  (`summarize.ts:609`); `web-scraper.ts:321-325` переключился на `if (itemsCount === 0)` вместо
  `html.includes("• ")`. Старый bullet-grep исчез. `pipeline.ts:103` корректно игнорирует
  лишнее поле через partial destructuring — TG-pipeline не сломался.
- **WR-05** — `formatDateRu` в `web-scraper.ts:184` теперь явно `timeZone: "Europe/Moscow"`,
  совпадает с `archive.ts:21` и устраняет рассинхрон файла и контента под Docker (TZ=UTC).
- **WR-08** — defensive shallow copy `[...loadChannels()]` в `pipeline.ts:28`. Для Fisher-Yates
  достаточно (мутируем только positional slots). Подтверждено, что `loadChannels()` возвращает
  `validated.channels` от Zod parse — формально fresh array, но защитная копия страхует
  от рефактора channels-store с кэшем.
- **WR-09** — outer try/catch в `tick()` (`run.ts:31-100`) ловит любую ошибку из jitter/TG/web
  блоков и шлёт `sendAlert({ stage: "tick" })`. `isRunning=false` всегда сбрасывается через
  `finally`. Утечки `isRunning=true` навсегда теперь не случится.
- Все 5 info-замечаний (IN-01..IN-05) сохраняют статус: либо невалидны
  (cheerio дублирование formatDateRu — оставлено осознанно), либо требуют
  больше work, чем стоит (рефактор process.chdir в тестах).

**Новых критических проблем не найдено.** Найдено 2 warnings и 4 info-замечания, в основном
о хрупкой строковой сравнении и edge-case redirect counting — все либо unlikely в проде,
либо имеют минимальный blast radius.

Тестовое покрытие осталось на прежнем уровне (26 it-кейсов в двух файлах). Тесты для
abortable jitter-sleep и outer tick try/catch (WR-01 / WR-09) — не добавлены; см. WR-NEW-01.

## Warnings

### WR-NEW-01: `tick()` распознаёт shutdown по `error.message === "shutdown"` — хрупкий sentinel

**File:** `src/run.ts:39-44`, `src/run.ts:111-127`
**Issue:** `abortableSleep` бросает `new Error("shutdown")`, и `tick()` распознаёт его так:

```typescript
} catch (e) {
  if ((e as Error).message === "shutdown") {
    log.info(`[tick] runId=${runId} aborted during jitter sleep`);
    return;
  }
  throw e;
}
```

Сравнение по `.message` — антипаттерн Node.js: при любом рефакторе `abortableSleep`
(капитализация, локализация, замена на стандартный `AbortError` через
`new DOMException("aborted", "AbortError")`) ветка `return` тихо перестанет срабатывать.
shutdown снова будет ждать pipeline (которого нет), а лог будет говорить, что прогон упал.

Дополнительно — Node.js native fetch при abort бросает `DOMException("This operation was
aborted", "AbortError")`, а не `Error("shutdown")`. Если бы `abortableSleep` использовал
`signal` напрямую (что было бы идиоматично), `error.name === "AbortError"` был бы
правильной проверкой; сейчас же используется самодельный sentinel-string.

**Fix:** Использовать sentinel-class вместо string-compare:

```typescript
class ShutdownError extends Error {
  constructor() { super("shutdown"); this.name = "ShutdownError"; }
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new ShutdownError()); return; }
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => { clearTimeout(t); reject(new ShutdownError()); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// в tick():
} catch (e) {
  if (e instanceof ShutdownError) {
    log.info(`[tick] runId=${runId} aborted during jitter sleep`);
    return;
  }
  throw e;
}
```

Или, как минимум, — заменить `e.message === "shutdown"` на `signal.aborted === true`:

```typescript
} catch (e) {
  if (activeAbort?.signal.aborted) {
    log.info(`[tick] runId=${runId} aborted during jitter sleep`);
    return;
  }
  throw e;
}
```

Источник истины — `signal.aborted`, а не текст ошибки.

### WR-NEW-02: `MAX_REDIRECT_HOPS=5` — лоoп выполняет 6 fetch'ей, error message off-by-one

**File:** `src/web-scraper.ts:56`, `src/web-scraper.ts:68-91`
**Issue:** Код:

```typescript
const MAX_REDIRECT_HOPS = 5;
// ...
for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
  const res = await fetch(currentUrl, { ... });
  if (res.status >= 300 && res.status < 400) {
    // ...
    if (hop === MAX_REDIRECT_HOPS) {
      throw new Error(`too many redirects (${MAX_REDIRECT_HOPS + 1}) starting from ${url}`);
    }
    currentUrl = nextUrl;
    continue;
  }
  // ...
}
```

Цикл выполняется 6 раз (`hop=0..5`), что соответствует **6 fetch'ам** = 5 редиректов
+ 1 финальный success-response. Но:

1. Комментарий line 52 говорит «Ограничение: до 5 hop'ов» — подразумевает 5 *fetch*'ей,
   а реально 6.
2. Error message `too many redirects (${MAX_REDIRECT_HOPS + 1})` = «too many redirects (6)».
   Юзер парсит это как «6 редиректов было», хотя в реальности было 6 fetch'ей или 5
   реальных редиректов.

Не security-bug, но запутывает диагностику. Browser-стандарт (Chrome/Firefox) — 20
редиректов; curl — 50; node fetch default — 20. 5 — нормальный консервативный лимит,
просто терминология сбита.

**Fix:** Согласовать терминологию (выбрать одно из двух):

Вариант A — лимит на число редиректов (не fetch'ей):
```typescript
const MAX_REDIRECTS = 5;
let redirectCount = 0;
let currentUrl = url;
if (!isSafePublicUrl(currentUrl)) throw new Error(`unsafe url: ${currentUrl}`);
while (true) {
  const res = await fetch(currentUrl, { ... });
  if (res.status >= 300 && res.status < 400) {
    if (++redirectCount > MAX_REDIRECTS) {
      throw new Error(`too many redirects (${MAX_REDIRECTS}) starting from ${url}`);
    }
    // resolve Location, isSafePublicUrl check, continue
    continue;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
```

Вариант B — оставить как есть, но обновить комментарий и error message:
```typescript
// Ограничение: до 6 fetch'ей (5 редиректов + 1 финальный response).
// ...
throw new Error(`too many redirects (${MAX_REDIRECT_HOPS}) starting from ${url}`);
```

## Info

### IN-NEW-01: Pre-fetch SSRF check уязвим к DNS rebinding

**File:** `src/schema.ts:87-96`, `src/web-scraper.ts:65-66`
**Issue:** `isSafePublicUrl` проверяет `parsed.hostname` против regex-denylist для
`localhost`, `127.x`, `10.x`, `192.168.x`, `172.16-31.x`, `169.254.x`, `::1`, `fc00:`, `fd00:`.
Но это TOCTOU-проверка по hostname-string, не по resolved IP. Атакующий, контролирующий
DNS публичного домена, может направить:

- `evil.example.com → 10.0.0.1` (private network) после прохождения Zod-validation
- DNS rebinding: первый lookup отдаёт public IP (CR-01 проверка проходит),
  второй lookup для `Host:` header отдаёт `127.0.0.1`

В контексте проекта это unlikely (websites.json редактируется вручную, не пользовательским
input'ом), но note-worthy. Полное mitigation требует resolve через `dns.lookup` и проверку
resolved IPs против CIDR-блоков — это уже за scope'ом minimal SSRF defense.

**Fix:** Не критично — CR-01 fix уже закрывает 95% реалистичных векторов. Если в будущем
`websites.json` станет user-editable (например через bot-команды `/add_website`), стоит
добавить:

```typescript
import { lookup } from "node:dns/promises";
import ip from "ipaddr.js"; // (новая deps)

async function resolvedIpIsPublic(hostname: string): Promise<boolean> {
  const { address } = await lookup(hostname);
  return !ip.parse(address).range().includes("private");
}
```

Сейчас — оставить как есть, добавить комментарий: «pre-fetch denylist; полная защита от DNS
rebinding отложена до bot-команд для websites».

### IN-NEW-02: `pipeline.ts` теряет `itemsCount` из summarize() — не реальная проблема, но inconsistency

**File:** `src/pipeline.ts:103`
**Issue:** Web-pipeline использует `itemsCount` для D-14 (silent on empty digest), но TG-pipeline
делает `const { html, postsDropped: dropped } = await summarize(freshPosts);` без проверки
items. Если LLM вернёт 0 items по 5 категориям и 0 mentions, TG-pipeline всё равно отправит
«пустой» дайджест (5 секций «— нет упоминаний за сутки»).

Это не баг — для TG это by design (CLAUDE.md: «Пустая секция явно помечается «— нет упоминаний
за сутки», не молчит»). Но inconsistency между TG и web pipeline'ами в обработке `itemsCount`
стоит явно задокументировать.

**Fix:** Не код-fix, а комментарий в `pipeline.ts:103`:
```typescript
// Note: TG-pipeline шлёт дайджест даже при itemsCount=0 (как указано в CLAUDE.md
// «Пустая секция явно помечается»). Web-pipeline (web-scraper.ts:325) silent-skips
// при itemsCount=0 — другое требование D-14.
const { html, postsDropped: dropped } = await summarize(freshPosts);
```

### IN-NEW-03: `web-scraper.test.ts:212-227` mock тестирует abort, но не покрывает race с success

**File:** `src/__tests__/web-scraper.test.ts:212-227`
**Issue:** Текущий тест на abort — mock fetch висит в `new Promise(...)` без таймаута, и
ждёт сигнал. Это покрывает «timeout сработал → abort → reject». Но не покрывает race:
что если fetch резолвится **одновременно** с abort'ом? В реальности
`AbortController.abort()` после получения response не должен ничего ломать, но
`clearTimeout(timer)` в `fetchSite:100` срабатывает в `finally` — порядок
operations важен.

Не critical (любая разумная реализация native fetch работает), но добавление race-теста
повысит уверенность.

**Fix:** Добавить (опционально):
```typescript
it("does not throw when fetch resolves before timeout fires", async () => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("ok", { status: 200 })
  );
  // 50ms timeout, but fetch resolves immediately
  const result = await fetchSite("https://x.com/", 50);
  expect(result).toBe("ok");
});
```

### IN-NEW-04: Нет тестов для WR-01 (abortable jitter-sleep) и WR-09 (outer try/catch in tick)

**File:** `src/run.ts:111-127`, `src/run.ts:31-100`
**Issue:** Auto-fix pass добавил две нетривиальные защиты в `run.ts`, но тестов на них нет.
Если кто-то в будущем рефакторит `tick()` и случайно уберёт outer try/catch (или
`abortableSleep` listener cleanup), регрессия пройдёт молча — обе защиты срабатывают только
в редких сценариях (SIGINT + сразу после cron-fire).

**Fix:** Добавить unit-тесты, экспортируя `abortableSleep` (либо в `__tests__` через `(run as any)`):

```typescript
// run.test.ts
describe("abortableSleep (WR-01)", () => {
  it("resolves after ms when signal not aborted", async () => {
    const ctrl = new AbortController();
    const start = Date.now();
    await abortableSleep(50, ctrl.signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
  it("rejects with shutdown when signal aborted before timeout", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    await expect(abortableSleep(1000, ctrl.signal)).rejects.toThrow(/shutdown/);
  });
  it("rejects immediately if signal already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortableSleep(1000, ctrl.signal)).rejects.toThrow(/shutdown/);
  });
});
```

Не блокер — но без них regression в WR-01/WR-09 fix вернёт нас к "daemon висит 30 минут после
SIGINT".

---

_Reviewed: 2026-05-06T19:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Re-review of phase 03-web-scraping after fix commits 22c9adc, 84fcc3c, 434f99a, c7ed0ba, 0e14a96, a23613b._
