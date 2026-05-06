---
phase: 260506-cad
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/summarize.ts
  - src/__tests__/summarize.test.ts
  - .env.example
  - README.md
autonomous: true
requirements:
  - QUICK-260506-CAD
must_haves:
  truths:
    - "Pass 1 классификация на 220+ постах больше не валится с ECONNRESET через 120s — каждый чанк укладывается в client timeout"
    - "При posts.length <= chunkSize классификация делается одним вызовом без overhead'а (как раньше)"
    - "При posts.length > chunkSize посты разбиваются на чанки ~CLASSIFY_CHUNK_SIZE и обрабатываются параллельно через Promise.allSettled"
    - "Падение одного чанка (после внутреннего retry) не валит весь pipeline — log.warn и продолжаем; посты этого чанка попадают в silent-drop как уже определено в bucketing"
    - "Размер чанка управляется env CLASSIFY_CHUNK_SIZE (дефолт 40, защита от NaN/<=0 → fallback на 40)"
    - "Логи на старт каждого чанка ([summarize] pass1: chunk N/M (X posts)) и итоговая строка с числом успешных/упавших чанков"
    - "Сигнатуры summarize() и classifyPosts() не изменились — pipeline.ts и тесты на summarize() работают без правок"
    - "Юнит-тесты vitest проходят (npm test зелёный), включая новый тест на чанкование"
  artifacts:
    - path: "src/summarize.ts"
      provides: "classifyPosts с внутренним classifyChunk + chunking-логика, экспортируемый chunkArray helper для тестируемости"
      contains: "classifyChunk"
    - path: "src/__tests__/summarize.test.ts"
      provides: "Юнит-тест на chunkArray (разбиение, edge cases: пустой массив, размер > длины, точное деление)"
      contains: "describe(\"chunkArray\""
    - path: ".env.example"
      provides: "Документирование CLASSIFY_CHUNK_SIZE с дефолтом 40"
      contains: "CLASSIFY_CHUNK_SIZE"
    - path: "README.md"
      provides: "Упоминание CLASSIFY_CHUNK_SIZE в списке опциональных env-переменных"
      contains: "CLASSIFY_CHUNK_SIZE"
  key_links:
    - from: "src/summarize.ts:classifyPosts"
      to: "src/summarize.ts:classifyChunk"
      via: "Promise.allSettled над chunks, склейка classifications"
      pattern: "Promise\\.allSettled"
    - from: "src/summarize.ts:classifyPosts"
      to: "process.env.CLASSIFY_CHUNK_SIZE"
      via: "parseInt с защитой от NaN/<=0, fallback 40"
      pattern: "CLASSIFY_CHUNK_SIZE"
    - from: "src/__tests__/summarize.test.ts"
      to: "src/summarize.ts:chunkArray"
      via: "import { chunkArray }"
      pattern: "import.*chunkArray"
---

<objective>
Pass 1 (`classifyPosts` в `src/summarize.ts`) шлёт все посты одним LLM-запросом. При 220 постах ответ DeepSeek генерируется дольше client timeout (120s) → ECONNRESET ровно через 2 минуты, весь прогон валится.

Решение: разбивать `posts` на чанки фиксированного размера (env `CLASSIFY_CHUNK_SIZE`, дефолт 40), запускать классификацию каждого чанка параллельно через `Promise.allSettled`, склеивать результаты в один массив `classifications`. Антифрагильно: упавший чанк (после внутреннего retry) → `log.warn`, продолжаем без него (посты получают silent-drop в существующей bucketing-логике, что уже корректное поведение).

Pass 2 (`summarizeCategory`) не трогаем — он уже параллельный по бакетам.

Purpose: устранить таймаут на больших прогонах без нового рантайм-сервиса/зависимостей; сохранить все существующие гарантии (Core Value: keyQuote дословно из исходника; антифрагильность по бакетам).

Output:
- `classifyPosts` с внутренним `classifyChunk` + chunking
- Экспортируемый helper `chunkArray<T>(arr, size): T[][]` для юнит-тестов
- Юнит-тест на `chunkArray`
- Документирование `CLASSIFY_CHUNK_SIZE` в `.env.example` и `README.md`
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@src/summarize.ts
@src/schema.ts
@src/__tests__/summarize.test.ts
@package.json
@.env.example

<interfaces>
<!-- Ключевые контракты, которые executor должен сохранить без изменений. -->

Сигнатура `classifyPosts` (private, не экспортируется — но НЕ менять, чтобы минимизировать diff):
```typescript
async function classifyPosts(
  client: OpenAI,
  posts: Post[],
  model: string
): Promise<ClassificationEntry[]>
```

Сигнатура `summarize` (public, pipeline.ts от неё зависит):
```typescript
export async function summarize(
  posts: Post[],
  _channelStats?: ChannelStats
): Promise<{ html: string; postsDropped: number }>
```

Тип результата (уже существует):
```typescript
export type ClassificationEntry = {
  url: string;
  category: Category | null;
  mentions: Mention[];
};
```

Schema-валидация (уже существует, не трогать):
```typescript
ClassificationResponseSchema = z.object({
  classifications: z.array(ClassificationEntrySchema),
})
```

Существующий retry-цикл внутри одного LLM-вызова (parsed → schema check → один retry → throw) сохраняется внутри `classifyChunk`. Внешний `Promise.allSettled` ловит throw и превращает в `rejected` без падения pipeline.

Logger API:
```typescript
log.info(msg: string)
log.warn(msg: string)
```

Существующий формат логов pass1:
- `[summarize] pass1: classifying ${posts.length} posts` (на старте всей классификации)
- `[summarize] pass1: response in ${ms}ms`
- `[summarize] pass1: ${relevant} relevant posts across ${N} buckets` (итог)

Новые логи (добавить):
- `[summarize] pass1: chunk ${i+1}/${total} (${chunk.length} posts)` — на старт каждого чанка (внутри `classifyChunk`)
- `[summarize] pass1: chunks ${succeeded}/${total} succeeded, ${failed} failed` — итог после Promise.allSettled (только в multi-chunk пути)
</interfaces>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Чанкование Pass 1 + helper chunkArray + env CLASSIFY_CHUNK_SIZE</name>
  <files>src/summarize.ts, src/__tests__/summarize.test.ts</files>
  <behavior>
    Тесты на `chunkArray<T>(arr: T[], size: number): T[][]` (новый экспорт):
    - chunkArray([], 5) → []
    - chunkArray([1,2,3], 5) → [[1,2,3]] (size > length)
    - chunkArray([1,2,3,4,5,6], 2) → [[1,2],[3,4],[5,6]] (точное деление)
    - chunkArray([1,2,3,4,5], 2) → [[1,2],[3,4],[5]] (остаток)
    - chunkArray([1,2,3], 1) → [[1],[2],[3]] (size=1)
    - Защита от невалидных аргументов: chunkArray([1,2,3], 0) → throw / либо trat as 1 chunk — выбрать throw для жёсткости (контракт явный)

    Поведение `classifyPosts` после рефакторинга (НЕ покрываем юнит-тестом, т.к. функция private + требует мок OpenAI; покрытие через ручной интеграционный прогон):
    - posts.length <= chunkSize → один вызов classifyChunk(posts) (single path, без Promise.allSettled overhead)
    - posts.length > chunkSize → chunkArray(posts, chunkSize) → Promise.allSettled над classifyChunk → склейка
    - Один rejected чанк → log.warn, остальные результаты используются
    - Все rejected → возвращается пустой массив (не throw): bucketing получит posts без classification и сделает silent drop (это текущее корректное поведение)
    - Env CLASSIFY_CHUNK_SIZE: parseInt; NaN/<=0/undefined → fallback 40
  </behavior>
  <action>
    **Шаг 1 — добавить helper в `src/summarize.ts`** (рядом с `groupByBucket`, экспортировать):

    ```typescript
    // ============================================================================
    // chunkArray — pure helper: разбивает массив на чанки фиксированного размера.
    // Экспортирован для юнит-тестов; используется в classifyPosts для разбиения
    // posts перед параллельной классификацией (избегаем client timeout 120s
    // при больших прогонах — 220+ постов).
    // ============================================================================
    export function chunkArray<T>(arr: T[], size: number): T[][] {
      if (size <= 0 || !Number.isFinite(size)) {
        throw new Error(`chunkArray: size must be a positive finite number, got ${size}`);
      }
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
      }
      return out;
    }
    ```

    **Шаг 2 — рефактор `classifyPosts` в `src/summarize.ts:270-321`**. Полная замена тела функции (сигнатура НЕ меняется):

    ```typescript
    async function classifyPosts(
      client: OpenAI,
      posts: Post[],
      model: string
    ): Promise<ClassificationEntry[]> {
      log.info(`[summarize] pass1: classifying ${posts.length} posts`);

      // Размер чанка: env CLASSIFY_CHUNK_SIZE с защитой от NaN/<=0/undefined.
      const rawChunkSize = process.env.CLASSIFY_CHUNK_SIZE;
      const parsed = rawChunkSize ? parseInt(rawChunkSize, 10) : NaN;
      const chunkSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 40;

      // Внутренняя функция: один LLM-вызов на один чанк постов.
      // Сохраняем существующий retry (parsed → schema check → один retry → throw).
      const classifyChunk = async (
        chunkPosts: Post[],
        chunkIdx: number,
        totalChunks: number
      ): Promise<ClassificationEntry[]> => {
        log.info(
          `[summarize] pass1: chunk ${chunkIdx + 1}/${totalChunks} (${chunkPosts.length} posts)`
        );
        const userMsg = JSON.stringify({
          posts: chunkPosts.map((p) => ({ url: p.url, text: p.text })),
        });

        const callLLM = async (): Promise<unknown> => {
          const startedAt = Date.now();
          const completion = await client.chat.completions.create({
            model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
              { role: "user", content: userMsg },
            ],
          });
          log.info(
            `[summarize] pass1: chunk ${chunkIdx + 1}/${totalChunks} response in ${Date.now() - startedAt}ms`
          );
          const raw = completion.choices[0]?.message?.content ?? "{}";
          try {
            return JSON.parse(raw);
          } catch (err) {
            throw new Error(
              `pass1 chunk ${chunkIdx + 1}/${totalChunks} invalid JSON: ${(err as Error).message}`
            );
          }
        };

        let parsedResp = await callLLM();
        let result = ClassificationResponseSchema.safeParse(parsedResp);
        if (!result.success) {
          console.warn(
            `[summarize] pass1 chunk ${chunkIdx + 1}/${totalChunks} schema fail: ${JSON.stringify(result.error.issues).slice(0, 300)} — retry`
          );
          parsedResp = await callLLM();
          result = ClassificationResponseSchema.safeParse(parsedResp);
          if (!result.success) {
            throw new Error(
              `pass1 chunk ${chunkIdx + 1}/${totalChunks} schema mismatch after retry: ` +
                JSON.stringify(result.error.issues).slice(0, 500)
            );
          }
        }
        return result.data.classifications as ClassificationEntry[];
      };

      // ---------------------------------------------------------------------------
      // Single path для маленьких прогонов: без Promise.allSettled overhead.
      // ---------------------------------------------------------------------------
      let classifications: ClassificationEntry[];
      if (posts.length <= chunkSize) {
        classifications = await classifyChunk(posts, 0, 1);
      } else {
        // -------------------------------------------------------------------------
        // Multi-chunk path: параллельная классификация через Promise.allSettled.
        // Антифрагильно: упавший чанк → log.warn, посты этого чанка получат
        // silent-drop в bucketing-логике (текущее корректное поведение).
        // -------------------------------------------------------------------------
        const chunks = chunkArray(posts, chunkSize);
        log.info(
          `[summarize] pass1: splitting into ${chunks.length} chunks of ~${chunkSize} posts (parallel)`
        );
        const settled = await Promise.allSettled(
          chunks.map((chunk, i) => classifyChunk(chunk, i, chunks.length))
        );
        classifications = [];
        let succeeded = 0;
        let failed = 0;
        for (let i = 0; i < settled.length; i++) {
          const r = settled[i]!;
          if (r.status === "fulfilled") {
            classifications.push(...r.value);
            succeeded++;
          } else {
            log.warn(
              `[summarize] pass1: chunk ${i + 1}/${chunks.length} FAILED — ${(r.reason as Error).message} (skipping ${chunks[i]!.length} posts)`
            );
            failed++;
          }
        }
        log.info(
          `[summarize] pass1: chunks ${succeeded}/${chunks.length} succeeded, ${failed} failed`
        );
      }

      const categoryBuckets = new Set(classifications.map((c) => c.category).filter(Boolean));
      const mentionOrphans = classifications.filter(
        (c) => c.category === null && c.mentions.length > 0
      ).length;
      const relevant = classifications.filter(
        (c) => c.category !== null || c.mentions.length > 0
      ).length;
      log.info(
        `[summarize] pass1: ${relevant} relevant posts across ${categoryBuckets.size + (mentionOrphans > 0 ? 1 : 0)} buckets`
      );

      return classifications;
    }
    ```

    **Что важно сохранить (review checklist):**
    - Сигнатура `classifyPosts(client, posts, model)` — без изменений
    - Сигнатура `summarize(posts, channelStats?)` — не трогаем вообще
    - Существующий retry-цикл (parsed → schema check → 1 retry → throw) — внутри `classifyChunk`
    - Все throw из `classifyChunk` ловятся `Promise.allSettled` → `log.warn` → пропуск чанка (антифрагильно)
    - Single path при `posts.length <= chunkSize` — без Promise.allSettled (минимум overhead на маленьких прогонах)
    - Логи: существующая итоговая `[summarize] pass1: ${relevant} relevant posts` сохраняется

    **Шаг 3 — добавить тесты в `src/__tests__/summarize.test.ts`**. Добавить импорт `chunkArray` в шапку файла:

    ```typescript
    import {
      escapeHtml,
      verifyExtractiveness,
      renderHtml,
      groupByBucket,
      chunkArray,
    } from "../summarize.js";
    ```

    И добавить новый describe-блок в конец файла:

    ```typescript
    // ---------------------------------------------------------------------------
    // describe("chunkArray")
    // ---------------------------------------------------------------------------

    describe("chunkArray", () => {
      it("returns empty array when input is empty", () => {
        expect(chunkArray([], 5)).toEqual([]);
      });

      it("returns single chunk when size > length", () => {
        expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
      });

      it("splits exactly when length is divisible by size", () => {
        expect(chunkArray([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
      });

      it("places remainder in last chunk", () => {
        expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      });

      it("works with size=1 (one element per chunk)", () => {
        expect(chunkArray([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
      });

      it("throws on size=0", () => {
        expect(() => chunkArray([1, 2, 3], 0)).toThrow(/positive finite number/);
      });

      it("throws on negative size", () => {
        expect(() => chunkArray([1, 2, 3], -1)).toThrow(/positive finite number/);
      });

      it("throws on NaN size", () => {
        expect(() => chunkArray([1, 2, 3], NaN)).toThrow(/positive finite number/);
      });
    });
    ```

    **НЕ менять:** ничего в `summarize`, `summarizeCategory`, `groupByBucket`, `verifyExtractiveness`, `renderHtml`, `escapeHtml`, `formatDateRu`. Никаких новых импортов/зависимостей.
  </action>
  <verify>
    <automated>npm test</automated>
  </verify>
  <done>
    - `src/summarize.ts`: добавлен и экспортирован `chunkArray<T>(arr, size): T[][]`
    - `src/summarize.ts`: `classifyPosts` рефакторен — внутренняя `classifyChunk`, env `CLASSIFY_CHUNK_SIZE` (дефолт 40, защита от NaN/<=0), single-path при `posts.length <= chunkSize`, multi-chunk с `Promise.allSettled` иначе
    - Сигнатуры `classifyPosts` и `summarize` без изменений; pipeline.ts не правится
    - `src/__tests__/summarize.test.ts`: добавлен `describe("chunkArray")` с 8 тест-кейсами (empty, size>length, exact, remainder, size=1, throw на 0/negative/NaN)
    - `npm test` зелёный (включая новые тесты + все существующие)
    - Существующий retry внутри одного LLM-вызова (parsed → schema check → 1 retry → throw) сохранён внутри `classifyChunk`
    - Падение чанка (после retry) → `log.warn`, остальные чанки доходят до bucketing
  </done>
</task>

<task type="auto">
  <name>Task 2: Документировать CLASSIFY_CHUNK_SIZE в .env.example и README.md</name>
  <files>.env.example, README.md</files>
  <action>
    **Шаг 1 — `.env.example`:** добавить блок `CLASSIFY_CHUNK_SIZE` сразу после `DEEPSEEK_BASE_URL` (строка 30) и перед секцией `# Параметры прогона`. Конкретно — после строки 30 (`DEEPSEEK_BASE_URL=https://api.deepseek.com`) вставить:

    ```
    # Размер чанка для Pass 1 классификации в src/summarize.ts.
    # При больших прогонах (200+ постов) один LLM-запрос упирается в client timeout 120s.
    # Разбиваем посты на чанки и классифицируем параллельно через Promise.allSettled.
    # Дефолт 40 проверен на проде; уменьшать при FloodWait/таймаутах, увеличивать только осознанно.
    CLASSIFY_CHUNK_SIZE=40
    ```

    Итог: пустая строка перед `# -----` секцией «Параметры прогона» сохраняется.

    **Шаг 2 — `README.md` строка 159:** в списке опциональных env-переменных добавить `CLASSIFY_CHUNK_SIZE` после `DEEPSEEK_MODEL`:

    Было:
    ```
    - **Опциональные** (значения по умолчанию подходят, см. `.env.example`): `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `FETCH_WINDOW_HOURS`, `MAX_MESSAGES_PER_CHANNEL`, `CHANNEL_DELAY_MS`, `LOG_LEVEL`.
    ```

    Стало:
    ```
    - **Опциональные** (значения по умолчанию подходят, см. `.env.example`): `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `CLASSIFY_CHUNK_SIZE`, `FETCH_WINDOW_HOURS`, `MAX_MESSAGES_PER_CHANNEL`, `CHANNEL_DELAY_MS`, `LOG_LEVEL`.
    ```

    **НЕ трогать:** структуру `.env.example`, остальные переменные README, никаких больших разделов добавлять не надо. Изменение точечное — только список + одна строка-описание в `.env.example`.
  </action>
  <verify>
    <automated>grep -q "CLASSIFY_CHUNK_SIZE=40" .env.example && grep -q "CLASSIFY_CHUNK_SIZE" README.md && echo OK</automated>
  </verify>
  <done>
    - `.env.example` содержит `CLASSIFY_CHUNK_SIZE=40` с комментарием в DeepSeek-блоке
    - `README.md:159` содержит `CLASSIFY_CHUNK_SIZE` в списке опциональных env-переменных
    - Других изменений в README нет
  </done>
</task>

</tasks>

<verification>
1. `npm test` — все тесты vitest зелёные, включая новый `describe("chunkArray")` (8 кейсов).
2. Существующие тесты (`escapeHtml`, `verifyExtractiveness`, `renderHtml`, `groupByBucket`) не сломались.
3. Сигнатуры `summarize` и `classifyPosts` идентичны до-рефакторингу (diff git показывает только тело + helper).
4. `grep -n "Promise.allSettled" src/summarize.ts` показывает два вызова: один в multi-chunk пути `classifyPosts`, второй существующий в `summarize` (Pass 2).
5. `grep -n "CLASSIFY_CHUNK_SIZE" .env.example README.md src/summarize.ts` показывает 3 файла с упоминанием.
6. Ручной smoke-test (опционально): `npm start` на реальных каналах — pass1 не валится с ECONNRESET; в логах видны `[summarize] pass1: chunk N/M ...` строки.
</verification>

<success_criteria>
- `src/summarize.ts:classifyPosts` разбивает посты на чанки `CLASSIFY_CHUNK_SIZE` (default 40), параллельно классифицирует, антифрагильно склеивает результаты.
- На малых прогонах (`posts.length <= chunkSize`) — single path без Promise.allSettled overhead.
- На больших прогонах (220 постов) — 6 чанков по 40 (последний 20), каждый укладывается в 120s timeout, полный pass1 проходит.
- Падение одного чанка → `log.warn` + продолжаем; падение всех → пустой `classifications` → bucketing silent-drop (текущее корректное поведение).
- Env `CLASSIFY_CHUNK_SIZE` задокументирован в `.env.example` и `README.md`.
- Юнит-тест на `chunkArray` покрывает edge cases: пустой массив, size > length, точное деление, остаток, size=1, throw на 0/negative/NaN.
- `npm test` зелёный.
- Никаких новых рантайм-зависимостей. Сигнатуры публичных функций не изменены.
</success_criteria>

<output>
After completion, create `.planning/quick/260506-cad-pass-1-src-summarize-ts-classifyposts-ll/260506-cad-SUMMARY.md` with:
- Файлы изменены: src/summarize.ts (helper chunkArray + рефактор classifyPosts), src/__tests__/summarize.test.ts (тесты chunkArray), .env.example (CLASSIFY_CHUNK_SIZE=40), README.md (упоминание в опциональных).
- Что проверено: npm test зелёный.
- Известные ограничения: интеграционное поведение classifyPosts (single vs multi-chunk path) не покрыто юнит-тестами — требует мок OpenAI клиента, что дороже helper-теста; покрытие через ручной smoke-test на реальных каналах.
- Эффект: при 220 постах pass1 теперь идёт ~ 6 параллельных запросов по ~40 постов вместо одного на 220 → каждый укладывается в 120s timeout DeepSeek SDK.
</output>
