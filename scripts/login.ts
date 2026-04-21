// scripts/login.ts — разовая генерация TG_SESSION через GramJS StringSession.
// Запуск: `npm run login` (подставляет --env-file=.env, так что TG_API_ID/TG_API_HASH видны через process.env)
// После успеха скрипт печатает строку StringSession — скопируй её в .env как TG_SESSION.

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!Number.isFinite(apiId) || apiId <= 0) {
  console.error(
    "TG_API_ID не задан или невалиден. Возьми его на https://my.telegram.org → API development tools.",
  );
  process.exit(1);
}
if (!apiHash || apiHash.length < 8) {
  console.error(
    "TG_API_HASH не задан. Возьми его на https://my.telegram.org → API development tools.",
  );
  process.exit(1);
}

const rl = readline.createInterface({ input, output });
const ask = (q: string): Promise<string> => rl.question(q);

async function main(): Promise<void> {
  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash as string, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      (await ask("Телефон (в международном формате, +7...): ")).trim(),
    phoneCode: async () => (await ask("Код из Telegram: ")).trim(),
    password: async () =>
      (await ask("2FA-пароль (если включён, иначе Enter): ")).trim(),
    onError: (err) => {
      console.error("Ошибка логина:", err);
    },
  });

  const saved = client.session.save() as unknown as string;
  console.log("\n============================================");
  console.log(
    "TG_SESSION получен. Скопируй строку ниже в .env как TG_SESSION:",
  );
  console.log("============================================\n");
  console.log(saved);
  console.log("\n============================================");
  console.log(
    "Готово. Не публикуй TG_SESSION — это полный доступ к твоему user-аккаунту.",
  );
  console.log("============================================");

  rl.close();
  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Фатальная ошибка:", err);
  process.exit(1);
});
