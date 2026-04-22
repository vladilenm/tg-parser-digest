// ecosystem.config.js — PM2-конфиг для tg-parser daemon.
// Запуск: pm2 start ecosystem.config.js (см. README секцию «Запуск на VPS (PM2)»).
// kill_timeout поднят с 1600мс (PM2 default) до 180000мс (3 минуты),
// чтобы graceful shutdown успел дождаться активного прогона перед SIGKILL.

module.exports = {
  apps: [
    {
      name: "tg-parser",
      script: "src/run.ts",
      interpreter: "node",
      interpreter_args: "--env-file=.env --import tsx",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      max_memory_restart: "300M",
      kill_timeout: 180000,
      time: true,
    },
  ],
};
