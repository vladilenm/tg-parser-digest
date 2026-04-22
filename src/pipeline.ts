// src/pipeline.ts — логика одного прогона tg-parser-demo.
// Вызывается из daemon-tick в src/run.ts; сама не знает про node-cron/PM2.

import { readFileSync } from "node:fs";
import yaml from "yaml";
import type { Post, RunSummary } from "./types.js";
import { createClient, fetchLast24h, sleep, randomInt } from "./telegram.js";
import { summarize } from "./summarize.js";
import { sendToChannel } from "./deliver.js";
import { log } from "./logger.js";

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

/**
 * Один прогон пайплайна: читает channels.yaml, обходит все каналы (per-channel try/catch),
 * дедуплицирует посты в рамках прогона, отдаёт батч DeepSeek'у, шлёт HTML в канал, возвращает RunSummary.
 * Не завершает процесс — ошибки пробрасывает вызывающему (daemon в src/run.ts).
 */
export async function runPipeline(): Promise<RunSummary> {
  const runId = crypto.randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const channels = loadChannelsYaml("./channels.yaml");
  const limit = Number(process.env.MAX_MESSAGES_PER_CHANNEL ?? 50);
  const windowHours = Number(process.env.FETCH_WINDOW_HOURS ?? 24);
  // SCALE-02: дефолт 1750 мс согласован с .env.example.
  const channelDelayMs = Number(process.env.CHANNEL_DELAY_MS ?? 1750);

  log.info(`[pipeline] runId=${runId} channels=${channels.length}`);

  const client = createClient();
  await client.connect();

  const seen = new Set<string>();
  const allPosts: Post[] = [];
  let channelsSucceeded = 0;
  let channelsSkipped = 0;
  let postsDeduped = 0;
  const errors: string[] = [];

  try {
    for (let i = 0; i < channels.length; i++) {
      const { username } = channels[i]!;
      try {
        const fetched = await fetchLast24h(client, username, { limit, windowHours });
        for (const post of fetched) {
          const key = `${post.channelUsername}:${post.messageId}`;
          if (seen.has(key)) {
            postsDeduped++;
            continue;
          }
          seen.add(key);
          allPosts.push(post);
        }
        channelsSucceeded++;
        log.info(`[pipeline] ${username}: ${fetched.length} постов`);
      } catch (err) {
        channelsSkipped++;
        const msg = (err as Error)?.message ?? String(err);
        errors.push(`${username}: ${msg}`);
        log.warn(`[pipeline] channel skipped: ${username} — ${msg}`);
      }
      if (i < channels.length - 1) {
        await sleep(channelDelayMs + randomInt(0, 500));
      }
    }
  } finally {
    await client.disconnect();
  }

  log.info(
    `[pipeline] собрано уникальных: ${allPosts.length}, дублей отброшено: ${postsDeduped}`
  );

  let digestDelivered = false;
  if (allPosts.length > 0) {
    const html = await summarize(allPosts);
    await sendToChannel(html);
    digestDelivered = true;
    log.info(`[pipeline] дайджест отправлен.`);
  } else {
    log.info("[pipeline] No posts in window — skipping digest");
  }

  const finishedAt = new Date().toISOString();
  return {
    runId,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    channelsTotal: channels.length,
    channelsSucceeded,
    channelsSkipped,
    postsCollected: allPosts.length,
    postsDeduped,
    digestDelivered,
    errors,
  };
}
