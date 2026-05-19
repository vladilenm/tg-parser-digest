---
quick_id: 260519-nxc
type: execute
wave: 1
depends_on: []
files_modified:
  - src/upload/storage.ts
  - src/bot.ts
  - src/__tests__/upload-storage.test.ts
autonomous: true
requirements: [QUICK-260519-NXC]

must_haves:
  truths:
    - "После загрузки xlsx с данными за прошлую ISO-неделю (например W19) команды /summarize и /upload_status находят эти файлы, а не пустую папку текущей недели"
    - "Если в data/uploads/ есть несколько неделных папок с xlsx, выбирается самая свежая (lexicographic по YYYY-Www)"
    - "Если data/uploads/ пуста или нет ни одной непустой недели — используется fallback (текущая MSK-неделя)"
    - "Папки с не-ISO-week именами и пустые недельные папки игнорируются при поиске latest"
    - "handleDocument продолжает сохранять файл в неделю, выведенную из latest-date внутри файла (не меняется)"
    - "npm test зелёный"
  artifacts:
    - path: "src/upload/storage.ts"
      provides: "Экспорт функции findLatestWeekWithUploads(uploadsRoot, fallback)"
      contains: "export function findLatestWeekWithUploads"
    - path: "src/bot.ts"
      provides: "Команды /summarize (handleSummarizeCommand) и /upload_status используют findLatestWeekWithUploads вместо currentMskWeek для определения недели"
      contains: "findLatestWeekWithUploads"
    - path: "src/__tests__/upload-storage.test.ts"
      provides: "Покрытие findLatestWeekWithUploads: empty/single/multiple/non-iso/empty-folder"
      contains: "describe(\"findLatestWeekWithUploads"
  key_links:
    - from: "src/bot.ts:handleSummarizeCommand"
      to: "src/upload/storage.ts:findLatestWeekWithUploads"
      via: "import + вызов вместо currentMskWeek() в начале функции"
      pattern: "findLatestWeekWithUploads\\("
    - from: "src/bot.ts:/upload_status handler"
      to: "src/upload/storage.ts:findLatestWeekWithUploads"
      via: "вызов вместо currentMskWeek() при определении week"
      pattern: "findLatestWeekWithUploads\\("
    - from: "src/upload/storage.ts:findLatestWeekWithUploads"
      to: "filesystem data/uploads/"
      via: "readdirSync + statSync для фильтра по xlsx-наличию"
      pattern: "readdirSync"
---

<objective>
Fix bug: `/summarize` и `/upload_status` смотрят в папку «текущей MSK-недели», а `handleDocument` сохраняет файлы в неделю latest-даты ВНУТРИ файла. Если юзер заливает данные за прошлую неделю (W19 при текущей W21) — команды отвечают «файлов не загружено», хотя файлы лежат в `data/uploads/2026-W19/`.

Purpose: устранить рассогласование путём добавления `findLatestWeekWithUploads(uploadsRoot, fallback)` в storage.ts и замены `currentMskWeek()` на этот helper в обеих command-handler'ах. `handleDocument` НЕ трогаем — он работает корректно (неделя = из данных файла).

Output:
- `src/upload/storage.ts` с экспортом `findLatestWeekWithUploads`
- `src/bot.ts` с обновлёнными `/summarize` и `/upload_status`
- `src/__tests__/upload-storage.test.ts` с покрытием новой функции
- зелёный `npm test`
- atomic commit `fix(quick-260519-nxc): resolve week from latest non-empty uploads folder`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@src/upload/storage.ts
@src/bot.ts
@src/__tests__/upload-storage.test.ts

<interfaces>
<!-- Существующие контракты, на которые опирается фикс. -->

From src/upload/storage.ts:
```typescript
export function isoWeekFolder(d: Date): string;
export function weekDir(week: string): string; // path.join(paths.dataDir, "uploads", week)
export function listWeek(week: string): WeekStatus;
export function saveUpload(buf, type, week): Promise<string>;
export function writeLastRun(week, runAt): void;
```

From src/paths.ts (используется внутри storage.ts):
```typescript
export const paths: { dataDir: string; ... };
// → uploadsRoot = path.join(paths.dataDir, "uploads")
```

From src/bot.ts (текущий баг):
```typescript
// строка 265–269: используется как источник недели в /summarize и /upload_status
function currentMskWeek(): string { ... }

// строка 366: правильное определение недели в handleDocument — НЕ менять
const week = isoWeekFolder(latest);

// строка 451: /summarize — БАГ (текущая неделя вместо latest non-empty)
const week = currentMskWeek();

// строка 666: /upload_status — БАГ (то же самое)
const week = currentMskWeek();
```

Новый контракт, который этот плагин добавляет:
```typescript
/**
 * Возвращает имя самой свежей ISO-week-папки в uploadsRoot, в которой
 * лежит хотя бы один *.xlsx. Если ни одной непустой недели нет —
 * возвращает fallback. Сортировка — lexicographic по имени папки
 * (корректна для формата YYYY-Www: 2026-W21 > 2026-W19).
 *
 * Папки с именами не вида /^\d{4}-W\d{2}$/ игнорируются.
 * Папки без *.xlsx (например, только .last-run.json) тоже игнорируются.
 * Если uploadsRoot не существует — возвращается fallback без throw.
 */
export function findLatestWeekWithUploads(uploadsRoot: string, fallback: string): string;
```
</interfaces>

<root_cause_analysis>
**Текущее поведение (баг):**
- `handleDocument` (src/bot.ts:362-366) парсит xlsx, находит latest date В ДАННЫХ файла, и сохраняет в `data/uploads/<weekOfLatest>/`. Это правильно: если юзер залил отчёт за 30.04–08.05, файлы окажутся в `2026-W19/`.
- `/summarize` (src/bot.ts:451) и `/upload_status` (src/bot.ts:666) определяют неделю как `currentMskWeek()` = ISO-неделя СЕГОДНЯ. Если сегодня 19.05.2026 (W21), они смотрят в `2026-W21/` — пустую папку.
- Результат: «файлов не загружено», хотя они лежат в W19.

**Что НЕ менять:** `handleDocument` остаётся как есть (week из latest-date в данных файла — правильное поведение по договорённости).

**Что менять:** определение `week` в `/summarize` и `/upload_status` — должны искать latest непустую недельную папку, fallback на `currentMskWeek()` если ни одной непустой нет.
</root_cause_analysis>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Добавить findLatestWeekWithUploads + тесты</name>
  <files>src/upload/storage.ts, src/__tests__/upload-storage.test.ts</files>
  <behavior>
    Покрытие в `src/__tests__/upload-storage.test.ts` (новый `describe("findLatestWeekWithUploads", ...)` рядом с существующим round-trip describe; использовать тот же mkdtempSync + DATA_DIR override pattern, но передавать uploadsRoot напрямую через параметр функции, без зависимости от paths.dataDir — функция чистая):

    - Test 1: `uploadsRoot` не существует на диске → возвращает fallback
    - Test 2: `uploadsRoot` существует, но пуст → возвращает fallback
    - Test 3: Одна непустая неделя (создан `2026-W19/birzha_prices.xlsx`) → возвращает `"2026-W19"`
    - Test 4: Две непустые недели (`2026-W19/birzha_prices.xlsx` и `2026-W21/fca.xlsx`) → возвращает `"2026-W21"` (lexicographic max)
    - Test 5: Папка с xlsx (`2026-W19/birzha_prices.xlsx`) и более новая БЕЗ xlsx (`2026-W21/` пустая или только `.last-run.json`) → возвращает `"2026-W19"` (пустая пропускается)
    - Test 6: Папки с не-ISO именами (`misc/`, `backup-2026-W20/`, `2026-w20` — lowercase 'w') игнорируются; единственная валидная — `2026-W19/birzha_prices.xlsx` → `"2026-W19"`
    - Test 7: Папка `2026-W21/` содержит только подпапку (без .xlsx файлов в корне) → пропускается; fallback на `2026-W19` если она единственная с xlsx
  </behavior>
  <action>
    **Шаг 1 — добавить функцию в `src/upload/storage.ts`** (добавить после `writeLastRun`, обновить импорт `readdirSync, statSync` из `node:fs`):

    ```ts
    import {
      writeFileSync,
      renameSync,
      existsSync,
      mkdirSync,
      readFileSync,
      readdirSync,
      statSync,
    } from "node:fs";

    // ... existing code unchanged ...

    /**
     * Регулярка ISO-week-папки: ровно "YYYY-Www" (uppercase W, 2 цифры недели).
     * Не путать с lowercase "2026-w20" — тот должен игнорироваться.
     */
    const ISO_WEEK_FOLDER_RE = /^\d{4}-W\d{2}$/;

    /**
     * Возвращает имя самой свежей ISO-week-папки в uploadsRoot, в которой
     * лежит хотя бы один *.xlsx. Если ни одной такой папки нет — fallback.
     *
     * Алгоритм:
     *   1. Если uploadsRoot не существует → fallback (без throw).
     *   2. readdirSync(uploadsRoot, { withFileTypes: true }).
     *   3. Оставить только directory entries с именем, матчащим ISO_WEEK_FOLDER_RE.
     *   4. Для каждой такой папки: readdirSync, проверить наличие хотя бы одного
     *      файла с расширением .xlsx (case-insensitive).
     *   5. Из непустых — взять lexicographic max (формат YYYY-Www гарантирует,
     *      что строковая сортировка совпадает с хронологической в пределах
     *      одного года; межгодовая граница тоже работает: "2025-W52" < "2026-W01").
     *   6. Вернуть max либо fallback.
     *
     * Не throw'ает при I/O-ошибках на конкретной поддиректории — пропускает её.
     */
    export function findLatestWeekWithUploads(
      uploadsRoot: string,
      fallback: string
    ): string {
      if (!existsSync(uploadsRoot)) return fallback;
      let entries: string[];
      try {
        entries = readdirSync(uploadsRoot);
      } catch {
        return fallback;
      }
      const nonEmptyWeeks: string[] = [];
      for (const name of entries) {
        if (!ISO_WEEK_FOLDER_RE.test(name)) continue;
        const dir = path.join(uploadsRoot, name);
        let isDir = false;
        try {
          isDir = statSync(dir).isDirectory();
        } catch {
          continue;
        }
        if (!isDir) continue;
        let files: string[];
        try {
          files = readdirSync(dir);
        } catch {
          continue;
        }
        const hasXlsx = files.some((f) => f.toLowerCase().endsWith(".xlsx"));
        if (hasXlsx) nonEmptyWeeks.push(name);
      }
      if (nonEmptyWeeks.length === 0) return fallback;
      nonEmptyWeeks.sort(); // ascending lexicographic
      return nonEmptyWeeks[nonEmptyWeeks.length - 1];
    }
    ```

    **Шаг 2 — расширить `src/__tests__/upload-storage.test.ts`** (добавить новый `describe` в конец файла, импортировать `findLatestWeekWithUploads`):

    ```ts
    import {
      isoWeekFolder,
      saveUpload,
      listWeek,
      writeLastRun,
      weekDir,
      findLatestWeekWithUploads,
    } from "../upload/storage.js";

    // ... существующие describe'ы без изменений ...

    describe("findLatestWeekWithUploads", () => {
      let tmp: string;

      beforeEach(() => {
        tmp = mkdtempSync(path.join(tmpdir(), "find-latest-week-test-"));
      });

      afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
      });

      it("returns fallback when uploadsRoot does not exist", () => {
        const missing = path.join(tmp, "does-not-exist");
        expect(findLatestWeekWithUploads(missing, "2026-W21")).toBe("2026-W21");
      });

      it("returns fallback when uploadsRoot is empty", () => {
        expect(findLatestWeekWithUploads(tmp, "2026-W21")).toBe("2026-W21");
      });

      it("returns the only non-empty week", () => {
        const w19 = path.join(tmp, "2026-W19");
        mkdirSync(w19, { recursive: true });
        writeFileSync(path.join(w19, "birzha_prices.xlsx"), "x");
        expect(findLatestWeekWithUploads(tmp, "2026-W21")).toBe("2026-W19");
      });

      it("returns latest of multiple non-empty weeks (lexicographic)", () => {
        const w19 = path.join(tmp, "2026-W19");
        const w21 = path.join(tmp, "2026-W21");
        mkdirSync(w19, { recursive: true });
        mkdirSync(w21, { recursive: true });
        writeFileSync(path.join(w19, "birzha_prices.xlsx"), "x");
        writeFileSync(path.join(w21, "fca.xlsx"), "y");
        expect(findLatestWeekWithUploads(tmp, "2026-W22")).toBe("2026-W21");
      });

      it("skips week folders without xlsx files (only .last-run.json)", () => {
        const w19 = path.join(tmp, "2026-W19");
        const w21 = path.join(tmp, "2026-W21");
        mkdirSync(w19, { recursive: true });
        mkdirSync(w21, { recursive: true });
        writeFileSync(path.join(w19, "birzha_prices.xlsx"), "x");
        writeFileSync(path.join(w21, ".last-run.json"), "{}");
        expect(findLatestWeekWithUploads(tmp, "2026-W22")).toBe("2026-W19");
      });

      it("ignores non-ISO folder names (misc, lowercase w, backups)", () => {
        const w19 = path.join(tmp, "2026-W19");
        mkdirSync(w19, { recursive: true });
        writeFileSync(path.join(w19, "birzha_prices.xlsx"), "x");
        mkdirSync(path.join(tmp, "misc"), { recursive: true });
        writeFileSync(path.join(tmp, "misc", "stuff.xlsx"), "z");
        mkdirSync(path.join(tmp, "2026-w20"), { recursive: true }); // lowercase w
        writeFileSync(path.join(tmp, "2026-w20", "a.xlsx"), "z");
        mkdirSync(path.join(tmp, "backup-2026-W20"), { recursive: true });
        writeFileSync(path.join(tmp, "backup-2026-W20", "a.xlsx"), "z");
        expect(findLatestWeekWithUploads(tmp, "2026-W22")).toBe("2026-W19");
      });

      it("skips week folder that contains only a subdirectory (no xlsx in root)", () => {
        const w19 = path.join(tmp, "2026-W19");
        const w21 = path.join(tmp, "2026-W21");
        mkdirSync(w19, { recursive: true });
        mkdirSync(path.join(w21, "subdir"), { recursive: true });
        writeFileSync(path.join(w19, "birzha_prices.xlsx"), "x");
        expect(findLatestWeekWithUploads(tmp, "2026-W22")).toBe("2026-W19");
      });
    });
    ```

    Не использовать `paths.dataDir`-override для этих тестов — функция чистая и принимает uploadsRoot параметром, проще писать unit-тесты в произвольной mkdtemp-папке без env-override.
  </action>
  <verify>
    <automated>npm test -- src/__tests__/upload-storage.test.ts</automated>
  </verify>
  <done>
    - `findLatestWeekWithUploads` экспортируется из `src/upload/storage.ts`
    - 7 новых тестов проходят (existence/empty/single/multiple/empty-week-folder/non-iso-names/only-subdir)
    - Существующие тесты `isoWeekFolder` и round-trip остаются зелёными
    - `npm test` целиком зелёный
  </done>
</task>

<task type="auto">
  <name>Task 2: Использовать findLatestWeekWithUploads в /summarize и /upload_status</name>
  <files>src/bot.ts</files>
  <action>
    **Шаг 1 — расширить импорт из storage.ts** (строки 11-17), добавив `findLatestWeekWithUploads`:

    ```ts
    import {
      findLatestWeekWithUploads,
      isoWeekFolder,
      listWeek,
      saveUpload,
      weekDir,
      writeLastRun,
    } from "./upload/storage.js";
    ```

    **Шаг 2 — добавить локальный helper `uploadsRootPath()`** рядом с `currentMskWeek()` (после строки ~269). Функция не экспортируется из storage.ts (там она внутренне через `paths.dataDir + "uploads"`), но мы можем вычислить её здесь, импортировав `paths`:

    Добавить импорт `paths`:
    ```ts
    import { paths } from "./paths.js";
    ```

    И helper:
    ```ts
    /**
     * Корень загрузок: ${DATA_DIR}/uploads. Берётся каждый раз свежо
     * (не кэшируется), т.к. paths.dataDir может зависеть от env-override
     * в тестах. Симметрично weekDir() в storage.ts.
     */
    function uploadsRootPath(): string {
      return path.join(paths.dataDir, "uploads");
    }
    ```

    **Шаг 3 — заменить call-site в `handleSummarizeCommand` (строка 451):**

    Было:
    ```ts
    const week = currentMskWeek();
    ```

    Стало:
    ```ts
    // Bug fix (quick-260519-nxc): /summarize должен искать latest неделю с
    // xlsx-файлами, а не «текущую MSK», иначе залитые за прошлую неделю
    // файлы (W19) не найдутся, когда сегодня W21.
    const week = findLatestWeekWithUploads(uploadsRootPath(), currentMskWeek());
    ```

    **Шаг 4 — заменить call-site в `/upload_status` handler (строка 666):**

    Было:
    ```ts
    if (cmd === "/upload_status") {
      const week = currentMskWeek();
      const status = listWeek(week);
    ```

    Стало:
    ```ts
    if (cmd === "/upload_status") {
      // Bug fix (quick-260519-nxc): /upload_status показывает latest неделю
      // с реально лежащими xlsx, а не пустую «текущую MSK» (см. /summarize).
      const week = findLatestWeekWithUploads(
        uploadsRootPath(),
        currentMskWeek()
      );
      const status = listWeek(week);
    ```

    **Шаг 5 — НЕ трогать:**
    - `handleDocument` (строка 366: `const week = isoWeekFolder(latest)` — правильно)
    - `currentMskWeek()` (строка 265-269: остаётся, используется как fallback в обоих call-site'ах; комментарий обновить — он уже говорит «для команды /upload_status», теперь актуально «для fallback в /summarize и /upload_status»)

    **Шаг 6 — обновить docstring `currentMskWeek()`** (строки 261-264):

    Было:
    ```ts
    /**
     * Текущая неделя в часовом поясе MSK (UTC+3).
     * Используется только для команды /upload_status — для save-операций мы берём
     * неделю из latest-date файла, а не из «сейчас».
     */
    ```

    Стало:
    ```ts
    /**
     * Текущая неделя в часовом поясе MSK (UTC+3).
     * Используется как FALLBACK в /summarize и /upload_status (через
     * findLatestWeekWithUploads): если в data/uploads/ нет ни одной непустой
     * недельной папки, показываем текущую MSK-неделю.
     * Для save-операций (handleDocument) — неделя берётся из latest-date файла.
     */
    ```
  </action>
  <verify>
    <automated>npm test && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `findLatestWeekWithUploads` импортирован в `src/bot.ts`
    - `handleSummarizeCommand` использует `findLatestWeekWithUploads(uploadsRootPath(), currentMskWeek())` вместо `currentMskWeek()`
    - `/upload_status` handler использует ту же конструкцию
    - `handleDocument` не изменён (по-прежнему `isoWeekFolder(latest)`)
    - `currentMskWeek()` остаётся определённой (используется как fallback) с обновлённым docstring'ом
    - `npm test` зелёный, `npx tsc --noEmit` без ошибок
    - Ручная проверка реального бага: если в `data/uploads/2026-W19/` есть `birzha_prices.xlsx` + `fca.xlsx`, а сегодня W21 (пустая) — `/summarize` и `/upload_status` показывают W19, не W21
  </done>
</task>

</tasks>

<verification>
**Автоматическая:**
1. `npm test` — все тесты (старые + 7 новых) зелёные
2. `npx tsc --noEmit` — без TypeScript-ошибок
3. `grep -n "currentMskWeek()" src/bot.ts` — должно быть 3 совпадения (определение + 2 fallback'а в новых вызовах); НЕ должно быть прямых `const week = currentMskWeek()` без обёртки `findLatestWeekWithUploads`
4. `grep -n "findLatestWeekWithUploads" src/bot.ts` — должно быть минимум 3 совпадения (импорт + 2 call-site'а)

**Ручная (опционально, для уверенности):**
1. Положить mock'и: `mkdir -p data/uploads/2026-W19 && touch data/uploads/2026-W19/birzha_prices.xlsx data/uploads/2026-W19/fca.xlsx`
2. Запустить бот (`npm start` или dev-режим) и в Telegram нажать «📊 Статус загрузок»
3. Ответ должен показывать «Папка 2026-W19» (а не W21)
4. После проверки: `rm -rf data/uploads/2026-W19` (cleanup)

Ручная проверка опциональна — unit-тесты покрывают логику; интеграционная проверка нужна только если есть сомнения в путях.
</verification>

<success_criteria>
- [ ] `findLatestWeekWithUploads(uploadsRoot, fallback): string` экспортирована из `src/upload/storage.ts`
- [ ] 7 новых unit-тестов покрывают: missing root, empty root, single week, multiple weeks (latest wins), empty week folder skipped, non-ISO names ignored (включая lowercase 'w'), only-subdir-no-xlsx skipped
- [ ] `handleSummarizeCommand` и `/upload_status` используют `findLatestWeekWithUploads(uploadsRootPath(), currentMskWeek())` вместо `currentMskWeek()` напрямую
- [ ] `handleDocument` НЕ изменён (неделя по-прежнему = `isoWeekFolder(latest)`)
- [ ] `currentMskWeek()` остаётся, docstring обновлён (роль fallback)
- [ ] `npm test` зелёный
- [ ] `npx tsc --noEmit` без ошибок
- [ ] Atomic commit: `fix(quick-260519-nxc): resolve week from latest non-empty uploads folder`
</success_criteria>

<output>
After completion, create `.planning/quick/260519-nxc-fix-week-resolution-summarize-upload-sta/260519-nxc-SUMMARY.md` следуя стандартному формату quick SUMMARY: что сделано, ключевые файлы (паттерн `path:line`), затронутые декоррации, follow-ups (если есть).
</output>
