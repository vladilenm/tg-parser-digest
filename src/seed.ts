// src/seed.ts — копирование дефолтных конфигов в persistent volume на первом запуске.
// Per docs/db-deploy.md §2: если ${DATA_DIR}/config/{channels,websites}.json
// отсутствует — копируем из ${SEED_DIR}/{channels,websites}.json (зашитые
// в Docker-образ в /app/seed/, локально — корень репо).
//
// Вызывается top-level из src/run.ts на старте daemon'а — ДО первого loadChannels().
// Если ни в data/, ни в seed-каталоге файла нет — throw с понятной ошибкой.

import { copyFileSync, existsSync } from "node:fs";
import { ensureDataDirs, paths } from "./paths.js";
import { log } from "./logger.js";

interface SeedTarget {
  name: string;
  data: string;
  seed: string;
}

/**
 * Создать data/-структуру и при первом запуске скопировать seed-файлы в config/.
 * Существующие файлы НЕ перетираются (volume-резидент).
 */
export function ensureSeedFiles(): void {
  ensureDataDirs();

  const targets: SeedTarget[] = [
    { name: "channels.json", data: paths.channelsConfig, seed: paths.seedChannels },
    { name: "websites.json", data: paths.websitesConfig, seed: paths.seedWebsites },
  ];

  for (const t of targets) {
    if (existsSync(t.data)) {
      log.info(`[seed] ${t.name}: found existing at ${t.data}, untouched`);
      continue;
    }
    if (!existsSync(t.seed)) {
      throw new Error(
        `[seed] no ${t.name} found at ${t.data} or seed at ${t.seed}`
      );
    }
    copyFileSync(t.seed, t.data);
    log.info(`[seed] ${t.name}: copied from seed (${t.seed} -> ${t.data})`);
  }
}
