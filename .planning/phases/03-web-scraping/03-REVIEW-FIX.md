---
phase: 03-web-scraping
fixed_at: 2026-05-06T00:00:00Z
review_path: .planning/phases/03-web-scraping/03-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-05-06
**Source review:** .planning/phases/03-web-scraping/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (1 Critical + 9 Warnings; Info skipped per scope)
- Fixed: 10
- Skipped: 0

## Fixed Issues

### CR-01: SSRF-вектор через `websites.json` — Zod валидирует только URL-формат, не protocol/host

**Files modified:** `src/schema.ts`, `src/web-scraper.ts`
**Commit:** 22c9adc
**Applied fix:** Добавил `PRIVATE_HOSTS` denylist (localhost / 127.x / 10.x / 192.168.x / 172.16-31.x / 169.254.x / IPv6 ::1, fc00:, fd00:) и helper `isSafePublicUrl(u)` в `src/schema.ts`. `WebsiteEntrySchema.url` теперь использует `.refine(isSafePublicUrl, ...)` после `z.string().url()`. В `fetchSite` (`src/web-scraper.ts`) заменил `redirect: "follow"` на `redirect: "manual"` с ручной revalidation `Location` через `isSafePublicUrl` — каждый hop проверяется по той же allowlist/denylist, лимит 5 redirects. Это закрывает прямой SSRF (cloud-metadata 169.254.169.254, RFC1918) и open-redirect chain через скомпрометированный публичный сайт. Покрывает также WR-07 (post-redirect revalidation).

### WR-01: Graceful shutdown не abort'ит jitter-sleep — daemon может висеть до 30 мин после SIGINT

**Files modified:** `src/run.ts`
**Commit:** 84fcc3c
**Applied fix:** Добавил `activeAbort: AbortController | null` module-level + helper `abortableSleep(ms, signal)` (rejects with `Error("shutdown")` при abort). `tick()` создаёт новый AbortController, использует `abortableSleep(jitterMs, activeAbort.signal)` вместо `setTimeout`-промиса, ловит `"shutdown"` и выходит с `log.info`. `shutdown(signal)` вызывает `activeAbort?.abort()` после `task.stop()` — sleeping tick немедленно завершается, не упираясь в PM2 `kill_timeout=180s` → SIGKILL посередине прогона. Скомбинировано с WR-09 в одном коммите (оба меняют `tick()`).

### WR-02: `package.json` рассинхронизирован с README — `yaml` декларирован в README, но удалён из deps; `cheerio` в deps, но не упомянут

**Files modified:** `README.md`
**Commit:** 434f99a
**Applied fix:** Обновил §«Установка зависимостей»: список из 5 runtime-deps теперь актуален (`telegram`, `openai`, `cheerio`, `node-cron`, `zod` — `yaml` удалён). В §«Структура проекта» заменил `channels.yaml` → `channels.json`, добавил строку про `websites.json`. В §«Подписка user-аккаунта» и §«Оперативная документация» все упоминания `channels.yaml` заменены на `channels.json`.

### WR-03: README §«Деплой VDS Шаг 4» показывает неправильный cron-schedule

**Files modified:** `README.md`
**Commit:** 434f99a
**Applied fix:** Обновил Шаг 4 деплоя на VDS: ожидаемый лог теперь `daemon started, schedule: 15 20 * * * Europe/Moscow + 0–30min jitter` (соответствует фактическому output из `src/run.ts:77`). Также обновил аналогичную строку в Шаге 5 первого запуска для единообразия.

### WR-04: `hasAnyItem` детектит наличие items по hard-coded `"• "` — silent breakage при изменении bullet-символа

**Files modified:** `src/summarize.ts`, `src/web-scraper.ts`
**Commit:** c7ed0ba
**Applied fix:** Расширил сигнатуру `summarize()`: возвращает `{html, postsDropped, itemsCount}`. `itemsCount` считается из `verifiedDigest` (сумма length по 5 категориям + mentions), что отражает реальное число items после серверной проверки дословности. В `src/web-scraper.ts` заменил `const hasAnyItem = html.includes("• ")` на `if (itemsCount === 0)`. Изменение bullet-символа в `renderHtml` больше не приведёт к silent-breakage web-дайджеста. Старый D-12 anchor-тест (`composeWebDigest.test.ts:249-282`) продолжает работать, новый контракт через `itemsCount` — структурный, не текстовый.

### WR-05: `formatDateRu` в `web-scraper.ts` использует локальный TZ хоста, не MSK

**Files modified:** `src/web-scraper.ts`
**Commit:** 0e14a96
**Applied fix:** Добавил `timeZone: "Europe/Moscow"` в `Intl.DateTimeFormat` опции внутри `formatDateRu`. Это устраняет рассинхрон между header HTML («🌐 Веб-источники — N мая Y г.») и именем архивного файла (`data/output/YYYY-MM-DD-web.md` — уже корректно использует `timeZone: "Europe/Moscow"` в `archive.ts`). Под Docker с TZ=UTC default header больше не «отстаёт на день».

### WR-06: `logger.ts:34` логирует `postsDropped`, но README §«Ежедневный summary-лог» этого не показывает

**Files modified:** `README.md`
**Commit:** 434f99a
**Applied fix:** В пример summary-блока добавил `dropped=12` в строку posts. В список «Поля» обновил пункт `posts:` — теперь явно описан как `collected=N deduped=K dropped=M` с раскрытием семантики `dropped` (STRUCT-03: пост вне 5 категорий и без mentions, либо не прошёл серверную проверку дословности `keyQuote`). Оператор больше не будет недоумевать при виде `dropped=N` в логах.

### WR-07: `redirect: "follow"` в `fetchSite` без host-revalidation

**Files modified:** `src/web-scraper.ts`
**Commit:** 22c9adc (объединено с CR-01)
**Applied fix:** Решено в рамках фикса CR-01 — `redirect: "manual"` + per-hop `isSafePublicUrl()` revalidation в цикле до 5 hop'ов. Каждый `Location` resolved'ится против `currentUrl` (как браузер) и проверяется через тот же allowlist/denylist что и исходный URL. Public сайт больше не может open-redirect'ом увести fetch на private-network.

### WR-08: `pipeline.ts` Fisher-Yates мутирует входной массив `channels` от `loadChannels()`

**Files modified:** `src/pipeline.ts`
**Commit:** a23613b
**Applied fix:** Заменил `const channels: ChannelEntry[] = loadChannels()` на `const channels: ChannelEntry[] = [...loadChannels()]` — defensive shallow copy перед Fisher-Yates. Сейчас `channels-store.loadChannels` возвращает свежий объект каждый вызов (нет cache), но defensive copy защищает от регрессии при будущем рефакторе store, и от race с concurrent bot-командами (`/channels`, `/add_channel`), читающими тот же snapshot. Явный комментарий объясняет защитное намерение.

### WR-09: `run.ts` не handle'ит ошибку из самого `tick()` — outer try/catch отсутствует

**Files modified:** `src/run.ts`
**Commit:** 84fcc3c (объединено с WR-01)
**Applied fix:** Обернул всё тело `tick()` (jitter + TG inner try + web inner try) ещё одним outer try/catch. Любая необработанная ошибка теперь логируется через `log.error` + отправляется alert через `sendAlert({stage: "tick", ...})`, не пробрасываясь в node-cron callback (где она была бы съедена молча). `isRunning = false` гарантированно сбрасывается в `finally`, daemon не залипает в `isRunning=true`. Скомбинировано с WR-01 в одном коммите (оба перерабатывают `tick()`).

## Skipped Issues

Все 10 in-scope findings успешно применены. Info-findings (IN-01..IN-05) намеренно вне scope для итерации `critical_warning`.

---

_Fixed: 2026-05-06_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
