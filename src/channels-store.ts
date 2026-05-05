// src/channels-store.ts — хранилище списка Telegram-каналов в channels.json.
// Phase 1 STORE-01/STORE-02: атомарная запись + in-process mutex.
// API: loadChannels (read, no mutex), saveChannels (atomic + mutex), mutate (read-modify-write + mutex).
// Auto-migration из channels.yaml — добавляется в Plan 01-02 (lazy внутри loadChannels).
// CRUD-обёртки (addChannel/removeChannel) — Phase 2 (D-09, рядом с бот-handler'ами).

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { z } from "zod";
import { log } from "./logger.js";

// D-10: единственная константа пути; не из env, не из аргумента.
export const CHANNELS_PATH = "./channels.json";

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
 * D-03: на битом JSON или провале Zod — throw наверх. Никакого fallback на YAML.
 * Auto-migration (если channels.json отсутствует) добавляется в Plan 01-02.
 */
export function loadChannels(): ChannelEntry[] {
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
