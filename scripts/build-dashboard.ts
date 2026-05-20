// scripts/build-dashboard.ts — CLI shim for `npm run dashboard`.
// All logic lives in src/dashboard.ts (also used by src/run.ts:tick()).

import { buildDashboard } from "../src/dashboard.js";

async function main(): Promise<void> {
  const { path: outFile, bytes } = await buildDashboard();
  console.log(`[dashboard] wrote ${outFile} (${(bytes / 1024).toFixed(1)} KB)`);
}

main().catch((err: unknown) => {
  console.error("[dashboard] FATAL:", err);
  process.exit(1);
});
