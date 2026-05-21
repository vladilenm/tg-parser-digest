// src/bitum/learned-signatures.ts — append-only storage для CLS-03 learning UX.
// Паттерн зеркалит src/channels-store.ts: atomic .tmp+rename + in-process mutex
// через serial Promise chain. Файл: ${DATA_DIR}/bitum/signatures-learned.json.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { paths } from "../paths.js";
import type { LearnedSignature } from "./types.js";

function learnedFilePath(): string {
  return path.join(paths.dataDir, "bitum", "signatures-learned.json");
}

/**
 * Возвращает массив LearnedSignature из файла (или [] если файла нет / malformed).
 * Не throw'ает (graceful fallback) — classifier работает и без learned-сигнатур.
 */
export function loadLearned(): LearnedSignature[] {
  const p = learnedFilePath();
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LearnedSignature[];
  } catch {
    return [];
  }
}

/**
 * Атомарный write JSON через .tmp + rename (POSIX-атомарность).
 * Симметрично src/channels-store.ts:atomicWriteJson.
 */
function atomicWriteJson(p: string, value: unknown): void {
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, p);
}

// In-process mutex (serial Promise chain) — гарантия что concurrent
// appendLearned() не теряют записи. Симметрично src/channels-store.ts mutex.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Дописывает одну сигнатуру в файл. Atomic + mutex.
 * BITUM-CLS-03/D-14: вызывается из bot callback_query handler при выборе типа
 * оператором (после inline-keyboard learning prompt).
 */
export function appendLearned(sig: LearnedSignature): Promise<void> {
  const next = writeChain.then(() => {
    const all = loadLearned();
    all.push(sig);
    atomicWriteJson(learnedFilePath(), all);
  });
  // Глотаем ошибки в chain (чтобы один upset write не блокировал следующие),
  // но возвращаем оригинальный promise — caller увидит конкретный reject.
  writeChain = next.catch(() => undefined);
  return next;
}
