// src/paths.ts — единый источник истины для путей persistent-volume и seed-файлов.
// Per docs/db-deploy.md §1: все мутабельные данные лежат под ${DATA_DIR}, дефолты —
// под ${SEED_DIR}. ENV переменные настраиваются в Docker (Task 4).
//
// Реализация через getter'ы: cwd / process.env могут меняться в тестах
// (vitest делает process.chdir(tmpdir) перед каждым тестом), поэтому пути
// резолвятся в момент обращения, а не при загрузке модуля.

import { mkdirSync } from "node:fs";
import path from "node:path";

function dataDir(): string {
  return process.env.DATA_DIR ?? path.resolve("./data");
}

function seedDir(): string {
  return process.env.SEED_DIR ?? path.resolve("./");
}

export const paths = {
  get dataDir(): string {
    return dataDir();
  },
  get configDir(): string {
    return path.join(dataDir(), "config");
  },
  get stateDir(): string {
    return path.join(dataDir(), "state");
  },
  get rawDir(): string {
    return path.join(dataDir(), "raw");
  },
  get outputDir(): string {
    return path.join(dataDir(), "output");
  },
  get logsDir(): string {
    return path.join(dataDir(), "logs");
  },
  get backupsDir(): string {
    return path.join(dataDir(), "backups");
  },

  get channelsConfig(): string {
    return path.join(dataDir(), "config", "channels.json");
  },
  get websitesConfig(): string {
    return path.join(dataDir(), "config", "websites.json");
  },
  get hashCache(): string {
    return path.join(dataDir(), "state", "hash-cache.json");
  },

  webPostsCache(mskDate: string): string {
    return path.join(dataDir(), "state", `web-posts-${mskDate}.json`);
  },
  rawTg(mskDate: string): string {
    return path.join(dataDir(), "raw", `${mskDate}.json`);
  },
  rawWeb(mskDate: string): string {
    return path.join(dataDir(), "raw", `${mskDate}-web.json`);
  },
  outputTg(mskDate: string): string {
    return path.join(dataDir(), "output", `${mskDate}.md`);
  },
  outputWeb(mskDate: string): string {
    return path.join(dataDir(), "output", `${mskDate}-web.md`);
  },
  logFile(mskDate: string): string {
    return path.join(dataDir(), "logs", `run-${mskDate}.log`);
  },

  get seedChannels(): string {
    return path.join(seedDir(), "channels.json");
  },
  get seedWebsites(): string {
    return path.join(seedDir(), "websites.json");
  },
};

/**
 * Создать все поддиректории под ${DATA_DIR}. Идемпотентно.
 * Вызывается из ensureSeedFiles() в src/seed.ts на старте daemon'а.
 */
export function ensureDataDirs(): void {
  for (const dir of [
    paths.configDir,
    paths.stateDir,
    paths.rawDir,
    paths.outputDir,
    paths.logsDir,
    paths.backupsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}
