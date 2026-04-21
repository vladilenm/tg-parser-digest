// src/run.ts — entrypoint MVP. Запуск: `npm start`.
// Склейка: channels.yaml → GramJS → Post[] → DeepSeek → HTML → Bot API.

import { readFileSync } from "node:fs";
import yaml from "yaml";
import type { Post } from "./types.js";
import { createClient, fetchLast24h, sleep, randomInt } from "./telegram.js";
import { summarize } from "./summarize.js";
import { sendToChannel } from "./deliver.js";

interface ChannelEntry {
  username: string;
  priority?: number;
}

interface ChannelsFile {
  channels: ChannelEntry[];
}

function loadChannelsYaml(path: string): ChannelEntry[] {
  const raw = readFileSync(path, "utf8");
  const parsed = yaml.parse(raw) as ChannelsFile | null;
  if (!parsed || !Array.isArray(parsed.channels)) {
    throw new Error(`${path}: корневой ключ "channels" отсутствует или не массив`);
  }
  const channels: ChannelEntry[] = [];
  for (const c of parsed.channels) {
    if (!c || typeof c.username !== "string" || !c.username) {
      throw new Error(`${path}: запись без строкового поля username: ${JSON.stringify(c)}`);
    }
    channels.push({ username: c.username, priority: c.priority });
  }
  if (channels.length < 1) {
    throw new Error(`${path}: список channels пуст`);
  }
  return channels;
}

export async function main(): Promise<void> {
  const channels = loadChannelsYaml("./channels.yaml");
  console.log(`[run] каналов в списке: ${channels.length}`);

  const limit = Number(process.env.MAX_MESSAGES_PER_CHANNEL ?? 50);
  const windowHours = Number(process.env.FETCH_WINDOW_HOURS ?? 24);
  const channelDelayMs = Number(process.env.CHANNEL_DELAY_MS ?? 1000);

  // RUN-01: создаём клиент, подключаемся
  const client = createClient();
  await client.connect();

  const posts: Post[] = [];
  try {
    for (let i = 0; i < channels.length; i++) {
      const { username } = channels[i]!;
      const fetched = await fetchLast24h(client, username, { limit, windowHours });
      posts.push(...fetched);
      console.log(`[run] ${username}: ${fetched.length} постов`);
      // FETCH-06: jitter между каналами (кроме после последнего).
      if (i < channels.length - 1) {
        await sleep(channelDelayMs + randomInt(0, 500));
      }
    }
  } finally {
    await client.disconnect();
  }

  console.log(
    `[run] всего собрано: ${posts.length} постов из ${new Set(posts.map((p) => p.channelUsername)).size} каналов`
  );

  // RUN-02: пустой день.
  if (posts.length === 0) {
    console.log("No posts in window — skipping digest");
    process.exit(0);
  }

  // RUN-03: summarize → deliver → exit 0.
  const html = await summarize(posts);
  await sendToChannel(html);
  console.log("[run] дайджест отправлен.");
  process.exit(0);
}

// Entrypoint: запускаем main() с глобальным catch.
main().catch((err) => {
  // RUN-03: любая ошибка → stderr + exit 1.
  console.error("[run] Фатальная ошибка:", err);
  process.exit(1);
});
