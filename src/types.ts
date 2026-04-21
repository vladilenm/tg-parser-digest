// src/types.ts — общие типы для пайплайна tg-parser-demo.

export interface Post {
  channelUsername: string; // без "@", как в channels.yaml
  messageId: number;
  postedAt: string; // ISO 8601, например "2026-04-21T10:15:03.000Z"
  text: string; // plain text сообщения (без entities)
  url: string; // "https://t.me/<username>/<messageId>"
}

export interface DigestItem {
  summary: string; // 1–2 предложения, до 250 символов
  keyQuote: string; // дословная подстрока Post.text
  url: string; // должен совпасть с Post.url одного из собранных постов
  channel: string; // Post.channelUsername (без "@")
}

export interface DigestSection {
  title: string; // короткий заголовок темы
  items: DigestItem[];
}

export interface DigestJson {
  generatedAt: string; // ISO 8601, заполняется DeepSeek-ом
  sections: DigestSection[];
}
