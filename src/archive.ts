// src/archive.ts — ФС-архивы прогонов: data/raw/*.json + data/output/*.md.
// ARCH-01: data/raw сохраняется ДО dedup и LLM (D-09 step 2).
// ARCH-02: data/output сохраняется ПОСЛЕ успешной доставки в Telegram (D-09 step 8),
//          байт-в-байт идентично отправленному HTML.
// D-10: дата MSK (Europe/Moscow), не UTC.
// D-11: re-run за тот же день перезаписывает файл.
// Атомарная запись через .tmp + rename (D-17).

import { writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Post } from "./types.js";
import { log } from "./logger.js";

const RAW_DIR = "./data/raw";
const OUTPUT_DIR = "./data/output";

/** D-10: YYYY-MM-DD в Europe/Moscow. Используем Intl.DateTimeFormat без зависимостей. */
function todayMsk(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA даёт YYYY-MM-DD напрямую.
  return fmt.format(new Date());
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Атомарная запись текстового файла через .tmp + rename. */
function atomicWriteText(path: string, content: string): void {
  ensureDir(dirname(path));
  const tmp = path + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/**
 * ARCH-01: записать все собранные сообщения за день в data/raw/YYYY-MM-DD.json.
 * Вызывается ПЕРЕД dedup и LLM. D-11: перезаписывает существующий файл за тот же день.
 */
export function writeRaw(posts: Post[], runId: string): void {
  const path = `${RAW_DIR}/${todayMsk()}.json`;
  // Каждый post сериализуется как { username, messageId, text, date, url } (по REQUIREMENTS).
  const payload = posts.map((p) => ({
    username: p.channelUsername,
    messageId: p.messageId,
    text: p.text,
    date: p.postedAt,
    url: p.url,
  }));
  atomicWriteText(path, JSON.stringify(payload, null, 2));
  log.info(`[archive] runId=${runId} wrote raw: ${path} (${posts.length} posts)`);
}

/**
 * ARCH-02: записать финальный HTML-дайджест в data/output/YYYY-MM-DD.md.
 * Вызывается ПОСЛЕ sendToChannel. Содержание байт-в-байт идентично отправленному.
 * D-11: перезаписывает существующий файл за тот же день.
 */
export function writeOutput(html: string, runId: string): void {
  const path = `${OUTPUT_DIR}/${todayMsk()}.md`;
  atomicWriteText(path, html);
  log.info(`[archive] runId=${runId} wrote output: ${path} (${html.length} chars)`);
}
