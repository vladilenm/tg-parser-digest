// src/types.ts — общие типы для пайплайна tg-parser-demo (v3.0).

export interface Post {
  channelUsername: string; // без "@", как в channels.yaml
  messageId: number;
  postedAt: string; // ISO 8601
  text: string;
  url: string; // "https://t.me/<username>/<messageId>"
}

/** Литералы 5 категорий v3.0. Порядок секций — D-03. */
export type Category = "bunker" | "oil" | "kerosene" | "petrochem" | "bitumen";

/** Литералы 3 целевых компаний-маркеров (D-04). */
export type Mention = "rosneft" | "lukoil" | "gazprom";

export interface DigestItem {
  category: Category | null;        // null → пост попал только в mentions (orphan)
  summary: string;                  // 1–2 предложения, до 250 символов
  keyQuote: string;                 // дословная подстрока Post.text (Core Value)
  url: string;                      // должен совпасть с Post.url
  channel: string;                  // Post.channelUsername (без "@")
  mentions: Mention[];              // подмножество ["rosneft","lukoil","gazprom"]; для orphan-mention items длина >=1
}

/** Структурированный ответ DeepSeek для v3.0: ровно 5 категорий + блок mentions (orphans only). */
export interface DigestJson {
  generatedAt: string;              // ISO 8601, заполняется DeepSeek
  bunker: DigestItem[];
  oil: DigestItem[];
  kerosene: DigestItem[];
  petrochem: DigestItem[];
  bitumen: DigestItem[];
  mentions: DigestItem[];           // только orphans (D-04): пост без category, но с mentions[]
}

export interface RunSummary {
  runId: string;                    // crypto.randomUUID().slice(0, 8)
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  channelsTotal: number;
  channelsSucceeded: number;
  channelsSkipped: number;
  postsCollected: number;           // уникальных постов после in-memory + hash-cache dedup
  postsDeduped: number;             // отброшено дублей (in-memory + hash-cache hits)
  postsDropped: number;             // STRUCT-03: отброшено LLM (вне 5 категорий и без mentions)
  digestDelivered: boolean;
  errors: string[];
}
