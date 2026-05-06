// src/pipeline.ts — логика одного прогона tg-parser-demo.
// Вызывается из daemon-tick в src/run.ts; сама не знает про node-cron/PM2.
// Список каналов читается через src/channels-store.ts (channels.json + auto-migration).

import type { Post, RunSummary } from "./types.js";
import { loadChannels, type ChannelEntry } from "./channels-store.js";
import { createClient, fetchLast24h, sleep, randomInt } from "./telegram.js";
import { summarize } from "./summarize.js";
import { sendToChannel } from "./deliver.js";
import { log } from "./logger.js";
import { writeRaw, writeOutput } from "./archive.js";
import { dedupAgainstCache, commitHashCache } from "./dedup.js";

/**
 * Один прогон пайплайна: читает channels.json через channels-store (auto-migration с YAML на первом запуске),
 * обходит все каналы (per-channel try/catch), дедуплицирует посты в рамках прогона,
 * отдаёт батч DeepSeek'у, шлёт HTML в канал, возвращает RunSummary.
 * Не завершает процесс — ошибки пробрасывает вызывающему (daemon в src/run.ts).
 */
export async function runPipeline(runId: string): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // WR-08: defensive shallow copy — Fisher-Yates ниже мутирует массив in-place;
  // если loadChannels когда-нибудь начнёт кэшировать internal state, мы бы перетёрли
  // его порядок и ломали concurrent bot-команды (/channels, /add_channel),
  // читающие тот же объект.
  const channels: ChannelEntry[] = [...loadChannels()];
  const limit = Number(process.env.MAX_MESSAGES_PER_CHANNEL ?? 50);
  const windowHours = Number(process.env.FETCH_WINDOW_HOURS ?? 24);
  // ANTIBAN: 1500 мс база + jitter 0–2500 мс = 1.5–4 сек разброс между каналами.
  const channelDelayMs = Number(process.env.CHANNEL_DELAY_MS ?? 1500);

  // ANTIBAN: Fisher-Yates shuffle — порядок каналов меняется каждый прогон,
  // чтобы не светить одну и ту же последовательность username-ов изо дня в день.
  for (let i = channels.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [channels[i], channels[j]] = [channels[j]!, channels[i]!];
  }

  log.info(`[pipeline] runId=${runId} channels=${channels.length}`);

  const client = createClient();
  await client.connect();

  const seen = new Set<string>();
  const allPosts: Post[] = [];
  let channelsSucceeded = 0;
  let channelsSkipped = 0;
  let postsDeduped = 0;
  let postsDropped = 0;
  const errors: string[] = [];

  try {
    for (let i = 0; i < channels.length; i++) {
      const { username } = channels[i]!;
      log.info(`[pipeline] [${i + 1}/${channels.length}] start: ${username}`);
      const startedAt = Date.now();
      try {
        const fetched = await fetchLast24h(client, username, { limit, windowHours });
        let dupInChannel = 0;
        for (const post of fetched) {
          const key = `${post.channelUsername}:${post.messageId}`;
          if (seen.has(key)) {
            postsDeduped++;
            dupInChannel++;
            continue;
          }
          seen.add(key);
          allPosts.push(post);
        }
        channelsSucceeded++;
        log.info(
          `[pipeline] [${i + 1}/${channels.length}] done: ${username} fetched=${fetched.length}` +
            (dupInChannel > 0 ? ` (deduped=${dupInChannel})` : "") +
            ` in ${Date.now() - startedAt}ms`
        );
      } catch (err) {
        channelsSkipped++;
        const msg = (err as Error)?.message ?? String(err);
        errors.push(`${username}: ${msg}`);
        log.warn(`[pipeline] [${i + 1}/${channels.length}] skip: ${username} — ${msg}`);
      }
      if (i < channels.length - 1) {
        // ANTIBAN: широкий jitter (0–2500 мс) — убираем равномерный rate-pattern.
        await sleep(channelDelayMs + randomInt(0, 2500));
      }
    }
  } finally {
    await client.disconnect();
  }

  log.info(
    `[pipeline] собрано уникальных: ${allPosts.length}, дублей отброшено: ${postsDeduped}`
  );

  // ARCH-01 (D-09 step 2): пишем raw СРАЗУ после fetch, до dedup и LLM.
  // Инвариант: «сырые данные за день сохранены, даже если остаток pipeline упал».
  writeRaw(allPosts, runId);

  let digestDelivered = false;
  if (allPosts.length > 0) {
    // DEDUP-01..02 (D-09 step 3-4): фильтруем allPosts через rolling hash-cache.
    const { fresh: freshPosts, hits: hashHits, freshHashes } = dedupAgainstCache(allPosts, runId);
    postsDeduped += hashHits;

    if (freshPosts.length === 0) {
      log.info("[pipeline] all posts dedup'ed by hash-cache — skipping digest");
    } else {
      // STRUCT-01..03 (D-09 step 5): summarize возвращает {html, postsDropped}.
      const { html, postsDropped: dropped } = await summarize(freshPosts);
      postsDropped = dropped;

      // RENDER-01..03 (D-09 step 7): доставка в Telegram.
      await sendToChannel(html);
      digestDelivered = true;
      log.info(`[pipeline] дайджест отправлен.`);

      // ARCH-02 (D-09 step 8): сохраняем output ТОЛЬКО после успешной доставки,
      //   байт-в-байт identical с отправленным.
      writeOutput(html, runId);

      // DEDUP-02 (D-09 step 8): hash-cache «съедает» только реально доставленные.
      commitHashCache(freshHashes, runId);
    }
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
    postsDropped,
    digestDelivered,
    errors,
  };
}
