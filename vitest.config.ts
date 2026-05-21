import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Сканируем тесты ТОЛЬКО в основном src/ — игнорируем .claude/worktrees/ копий,
    // которые остаются после прошлых GSD-сессий и засоряют test-runner результатами
    // устаревших файлов. Phase 04 Rule 3 — blocking issue для baseline tests.
    include: ["src/**/*.{test,spec}.{ts,js,mts,mjs,tsx,jsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      ".claude/**",
      ".planning/**",
    ],
  },
});
