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
