// src/schema.ts — Zod-валидация ответа DeepSeek для v3.0 (STRUCT-02).
// Живёт отдельно от src/summarize.ts (D-16): prompt и schema эволюционируют независимо.

import { z } from "zod";

export const CATEGORIES = ["bunker", "oil", "kerosene", "petrochem", "bitumen"] as const;
export const MENTIONS = ["rosneft", "lukoil", "gazprom"] as const;

export const CategorySchema = z.enum(CATEGORIES);
export const MentionSchema = z.enum(MENTIONS);

export const DigestItemSchema = z.object({
  category: CategorySchema.nullable(),
  summary: z.string().min(1).max(500),
  keyQuote: z.string().min(1),
  url: z.string().url(),
  channel: z.string().min(1),
  mentions: z.array(MentionSchema),
});

export const DigestJsonSchema = z.object({
  generatedAt: z.string().min(1),
  bunker: z.array(DigestItemSchema),
  oil: z.array(DigestItemSchema),
  kerosene: z.array(DigestItemSchema),
  petrochem: z.array(DigestItemSchema),
  bitumen: z.array(DigestItemSchema),
  mentions: z.array(DigestItemSchema),
});

export type DigestJsonZ = z.infer<typeof DigestJsonSchema>;

// ============================================================================
// Two-pass LLM schemas (260504-ew9)
// Pass 1: classification — one LLM call to classify all posts into categories + mentions
// Pass 2: per-category summarization — one LLM call per non-empty bucket
// ============================================================================

export const ClassificationEntrySchema = z.object({
  url: z.string().url(),
  category: CategorySchema.nullable(),
  mentions: z.array(MentionSchema),
});

export const ClassificationResponseSchema = z.object({
  classifications: z.array(ClassificationEntrySchema),
});

export const CategoryItemSchema = z.object({
  summary: z.string().min(1).max(500),
  keyQuote: z.string().min(1),
  url: z.string().url(),
  channel: z.string().min(1),
  mentions: z.array(MentionSchema),
});

export const CategoryItemsResponseSchema = z.object({
  items: z.array(CategoryItemSchema),
});

// ============================================================================
// WebsitesFileSchema (Phase 3 D-22) — валидация ./websites.json при чтении.
// Формат: { websites: [{ url, name? }] }. Минимум 1 запись (как ChannelsFileSchema).
// url: http(s) only + denylist private-network — защита от SSRF (T-03-01, CR-01).
// name: optional, используется как Post.channelUsername (fallback: hostname без www).
// ============================================================================

// Denylist приватных/loopback/link-local hostname'ов: блокирует SSRF к
// cloud-metadata (169.254.169.254), localhost, RFC1918 и IPv6 ULA/loopback.
const PRIVATE_HOSTS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd00:/i,
];

/**
 * isSafePublicUrl — exported helper, переиспользуется fetchSite для
 * post-redirect revalidation (см. WR-07).
 * Возвращает true только для http(s) с public hostname.
 */
export function isSafePublicUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (PRIVATE_HOSTS.some((re) => re.test(parsed.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

export const WebsiteEntrySchema = z.object({
  url: z
    .string()
    .url()
    .refine(isSafePublicUrl, {
      message: "url must be http(s) and not point to private/loopback/link-local network",
    }),
  name: z.string().min(1).optional(),
});

export const WebsitesFileSchema = z.object({
  websites: z.array(WebsiteEntrySchema).min(1),
});

export type WebsiteEntry = z.infer<typeof WebsiteEntrySchema>;
