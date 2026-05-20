// src/backup.ts — daily backup config/+state/ в закрытый Telegram-канал.
// Per docs/db-deploy.md §3: cron 15 3 * * * Europe/Moscow (см. src/run.ts) —
// раз в сутки tar.gz содержимого ${DATA_DIR}/config + ${DATA_DIR}/state и
// загружает архив через bot.sendDocument. Локально хранит 7 последних копий
// в ${DATA_DIR}/backups/, старые удаляет.
//
// Никаких новых runtime-зависимостей: tar — системная утилита (есть в node:20-slim,
// явно подтверждён в Dockerfile Task 4); FormData/Blob — Node 20+ глобальные.
// fetch для sendDocument — глобальный (undici в Node 20+).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { paths } from "./paths.js";
import { log } from "./logger.js";

const BACKUP_RETAIN = 7;
const TG_API = "https://api.telegram.org";

function mskDateYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function tgSendDocument(
  token: string,
  chatId: string,
  filePath: string,
  caption: string
): Promise<void> {
  const buf = readFileSync(filePath);
  // Buffer is a Uint8Array — Blob accepts it directly. Cast keeps TS happy
  // because lib.dom typings expect BlobPart which doesn't include Buffer.
  const blob = new Blob([buf as unknown as ArrayBuffer], { type: "application/gzip" });
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", blob, path.basename(filePath));
  if (caption) form.append("caption", caption);
  // Daily backup в 03:15 не должен будить оператора пушем.
  form.append("disable_notification", "true");

  const res = await fetch(`${TG_API}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`tgSendDocument: ${res.status} ${body}`);
  }
}

function pruneOldBackups(dir: string, retain: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const archives = entries
    .filter((f) => f.startsWith("config-") && f.endsWith(".tgz"))
    .map((name) => {
      const full = path.join(dir, name);
      let mtime = 0;
      try {
        mtime = statSync(full).mtimeMs;
      } catch {
        // Пропускаем недоступный файл.
      }
      return { name, full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const toRemove = archives.slice(retain);
  for (const a of toRemove) {
    try {
      unlinkSync(a.full);
    } catch (err) {
      log.warn(`[backup] prune failed for ${a.full}: ${(err as Error).message}`);
    }
  }
  if (toRemove.length > 0) {
    log.info(`[backup] pruned ${toRemove.length} old backups, kept ${retain}`);
  }
}

/**
 * Создать tar.gz config/ + state/, отправить в Telegram, вычистить старые.
 * Никогда не throw'ит наверх — daemon не должен падать из-за бэкапа.
 */
export async function backupAndSend(): Promise<void> {
  try {
    const ymd = mskDateYmd();
    const archivePath = path.join(paths.backupsDir, `config-${ymd}.tgz`);

    // -C ${DATA_DIR}: внутри архива пути относительные (config/..., state/...).
    execFileSync(
      "tar",
      ["czf", archivePath, "-C", paths.dataDir, "config", "state"],
      { stdio: "pipe" }
    );

    const buf = readFileSync(archivePath);
    const size = buf.length;
    const sha256 = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    log.info(`[backup] archive: ${archivePath} size=${size}b sha256=${sha256}`);

    const token = process.env.BOT_TOKEN_ALERTS;
    const chatId = process.env.ALERTS_CHAT_ID;
    if (!token || !chatId) {
      log.warn(
        "[backup] BOT_TOKEN_ALERTS или ALERTS_CHAT_ID не задан — backup skipped"
      );
      return;
    }

    const caption = `tg-parser-demo backup ${ymd}\nsize=${size}b sha256=${sha256}`;
    await tgSendDocument(token, chatId, archivePath, caption);
    log.info(`[backup] uploaded to chat=${chatId}`);

    pruneOldBackups(paths.backupsDir, BACKUP_RETAIN);
  } catch (err) {
    const e = err as Error;
    log.error(`[backup] failed: ${e?.message ?? String(err)}`, e);
  }
}
