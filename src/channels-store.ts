// src/channels-store.ts — хранилище списка Telegram-каналов в channels.json.
// Phase 1 STORE-01/STORE-02: атомарная запись + in-process mutex.
// API: loadChannels (read, no mutex), saveChannels (atomic + mutex), mutate (read-modify-write + mutex).
// Auto-migration из channels.yaml — добавляется в Plan 01-02 (lazy внутри loadChannels).
// CRUD-обёртки (addChannel/removeChannel) — Phase 2 (D-09, рядом с бот-handler'ами).

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import yaml from "yaml";
import { z } from "zod";
import { log } from "./logger.js";

// D-10: единственная константа пути; не из env, не из аргумента.
export const CHANNELS_PATH = "./channels.json";
// D-11: source для lazy auto-migration. Internal — НЕ экспортируется.
const YAML_FALLBACK_PATH = "./channels.yaml";

// D-01: схема 1:1 как в channels.yaml — никаких version-обёрток или audit-полей.
const ChannelEntrySchema = z.object({
  username: z.string().min(1),
  priority: z.number().int().optional(),
});

const ChannelsFileSchema = z.object({
  channels: z.array(ChannelEntrySchema).min(1),
});

export type ChannelEntry = z.infer<typeof ChannelEntrySchema>;
type ChannelsFile = z.infer<typeof ChannelsFileSchema>;

/**
 * Прочитать channels.json и вернуть массив каналов.
 * D-06: без mutex — POSIX rename(2) гарантирует, что reader увидит либо старый, либо новый файл целиком.
 * D-03: на битом JSON или провале Zod — throw наверх.
 *
 * STORE-03 / D-11: lazy auto-migration. Если channels.json отсутствует — читаем channels.yaml,
 * пишем JSON через .tmp + rename, возвращаем массив. Идемпотентно: при следующем вызове JSON уже есть.
 * D-12: channels.yaml остаётся на диске как backup (никакого .bak rename, никакого удаления).
 * D-13: если оба файла отсутствуют — throw.
 */
export function loadChannels(): ChannelEntry[] {
  if (!existsSync(CHANNELS_PATH)) {
    // D-13: ни JSON, ни YAML — нечего мигрировать.
    if (!existsSync(YAML_FALLBACK_PATH)) {
      throw new Error(
        `[channels-store] no source file: neither ${CHANNELS_PATH} nor ${YAML_FALLBACK_PATH} exists`
      );
    }
    // D-11: миграция YAML → JSON.
    const yamlRaw = readFileSync(YAML_FALLBACK_PATH, "utf8");
    let yamlParsed: unknown;
    try {
      yamlParsed = yaml.parse(yamlRaw);
    } catch (err) {
      throw new Error(
        `[channels-store] failed to parse ${YAML_FALLBACK_PATH}: ${(err as Error).message}`
      );
    }
    const validated: ChannelsFile = ChannelsFileSchema.parse(yamlParsed);
    // Синхронная атомарная запись — миграция должна завершиться до return массива.
    // Mutex в этой ветке не нужен: первый запуск, конкурентов на запись нет.
    atomicWriteJson(CHANNELS_PATH, validated);
    log.info(
      `[channels-store] migrated ${YAML_FALLBACK_PATH} → ${CHANNELS_PATH} (${validated.channels.length} каналов)`
    );
    return validated.channels;
  }

  // Основной путь: channels.json существует.
  const raw = readFileSync(CHANNELS_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[channels-store] failed to parse ${CHANNELS_PATH}: ${(err as Error).message}`
    );
  }
  const validated: ChannelsFile = ChannelsFileSchema.parse(parsed);
  return validated.channels;
}

// =============================================================================
// Atomic write helper — паттерн из src/archive.ts:34-39, адаптированный под JSON.
// =============================================================================

/**
 * Атомарная запись JSON через .tmp + rename. POSIX rename(2) — атомарная операция,
 * reader никогда не увидит частично записанный файл.
 * D-04: JSON.stringify(value, null, 2) — двухпробельный отступ как в data/raw/*.json.
 */
function atomicWriteJson(path: string, value: unknown): void {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, path);
}

// =============================================================================
// In-process mutex — самописный promise-chain, ~10 LOC.
// D-05: НИКАКОЙ новой зависимости (async-mutex отклонён ради 5-deps cap).
// D-06: сериализует ТОЛЬКО записи. loadChannels() читает напрямую без блокировки.
// =============================================================================

let lockChain: Promise<void> = Promise.resolve();

/**
 * Поставить операцию в очередь mutex'а. Возвращает Promise, который резолвится,
 * когда op завершилась (успешно или с ошибкой). Mutex освобождается в любом случае.
 */
function withLock<T>(op: () => Promise<T>): Promise<T> {
  const result = lockChain.then(op, op);
  // Хвост цепочки не должен реджектить следующего ожидающего — глотаем ошибку
  // в продолжении, но возвращаем оригинальный result наверх.
  lockChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// =============================================================================
// Public write API.
// =============================================================================

/**
 * Записать массив каналов в channels.json. Атомарно через .tmp + rename, под mutex'ом.
 * D-07/D-08: один из трёх public методов store-API.
 */
export function saveChannels(channels: ChannelEntry[]): Promise<void> {
  return withLock(async () => {
    // Валидируем перед записью — гарантия, что на диск не уйдёт битая структура.
    const payload: ChannelsFile = ChannelsFileSchema.parse({ channels });
    atomicWriteJson(CHANNELS_PATH, payload);
  });
}

/**
 * Read-modify-write критическая секция под mutex'ом. Точка входа для бот-команд в Phase 2.
 * D-07: сигнатура спроектирована под use-case `mutate(channels => [...channels, { username, priority }])`.
 *
 * ВАЖНО: внутри fn НЕЛЬЗЯ вызывать mutate/saveChannels снова — это deadlock.
 * Можно вызвать loadChannels (он читает без mutex'а), но обычно этого не нужно — fn получает current на вход.
 */
export function mutate(
  fn: (current: ChannelEntry[]) => Promise<ChannelEntry[]> | ChannelEntry[]
): Promise<void> {
  return withLock(async () => {
    // Внутри mutex'а читаем актуальный snapshot (а не используем переданный извне) —
    // гарантия, что concurrent mutate видит результат предыдущего.
    const current = loadChannels();
    const next = await fn(current);
    const payload: ChannelsFile = ChannelsFileSchema.parse({ channels: next });
    atomicWriteJson(CHANNELS_PATH, payload);
  });
}
