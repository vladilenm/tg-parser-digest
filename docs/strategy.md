# Тестирование Phase 1 — пошаговое руководство

> Phase 1 status: `human_needed` — все статические gates пройдены, ждём smoke-прогон с реальными секретами.

---

## 0. Что уже есть в `.env` (статус)

| Переменная | Статус |
|---|---|
| `TG_API_ID`, `TG_SESSION`, `TG_BOT_TOKEN`, `DEEPSEEK_API_KEY` | заполнены |
| `BOT_TOKEN_ALERTS`, `ALERTS_CHAT_ID` | **отсутствуют** — без них прогон упадёт сразу при первой ошибке (ALERT-01 sendAlert бросит `Missing BOT_TOKEN_ALERTS`) |
| `TG_API_HASH`, `TG_CHANNEL_ID`, прочие | проверь сам |
| `channels.yaml` | **39 PLACEHOLDER** из ~60 — реальных каналов мало |

---

## 1. Что доделать ДО первого `npm start`

### Шаг 1.1 — alert-бот (5 минут)

В Telegram открой [@BotFather](https://t.me/BotFather):

```
/newbot
→ имя: tg-parser-alerts (любое)
→ username: <уникальный>_alerts_bot
← скопировать Bot Token  → BOT_TOKEN_ALERTS=...
```

Затем:

1. Найди своего нового alert-бота в поиске Telegram, нажми **Start** (иначе бот не сможет писать в личку — это требование Bot API).
2. Перешли любое его сообщение в [@userinfobot](https://t.me/userinfobot) — он вернёт твой numeric `chat_id` → `ALERTS_CHAT_ID=...`.
3. Допиши обе строки в `.env` (без кавычек).

### Шаг 1.2 — channels.yaml (опционально для smoke)

Можешь не трогать сейчас — PLACEHOLDER каналы просто промаркируются как skipped (`UsernameNotOccupiedError`), прогон пойдёт по реальным. Для **полноценного** smoke перед Phase 2 нужно заменить все 39, но для проверки что код вообще работает — достаточно текущих 20+ реальных.

---

## 2. Запуск smoke-прогона

```bash
npm start
```

Один прогон, занимает ~30–90 секунд. `Ctrl+C` чтобы прервать.

### Что увидишь в stdout (по фазам D-09)

```
[info] run start runId=2026-04-26T...
[info] fetched ch=neftegazru posts=12
[info] fetched ch=oilfornication posts=8
...
[warn] skipped ch=PLACEHOLDER_01 reason=UsernameNotOccupiedError
...
[info] writeRaw runId=... posts=N             ← T9, ARCH-01: сырые до dedup
[info] dedup runId=... fresh=K dropped=N-K    ← T8, DEDUP-02
[info] summarize runId=... posts=K            ← T4-T6, в DeepSeek
[info] sendToChannel runId=... html=L bytes   ← в канал Заказчика
[info] writeOutput runId=...                  ← T9, ARCH-02: байт-в-байт что отправили
[info] commitHashCache runId=... +K hashes    ← T8, ТОЛЬКО после успешной доставки
[info] run done runId=... posts=N dropped=M ms=XXXX
```

### Что появится на диске

```
data/
  raw/2026-04-26.json          ← все посты до dedup
  output/2026-04-26.md         ← HTML, который ушёл в канал Заказчика
  hash-cache.json              ← SHA-256 хеши за 14 дней (rolling)
```

### Что увидишь в Telegram

**Канал Заказчика (`TG_CHANNEL_ID`):**

```
🛢 Нефтегазовый дайджест за 24 часа

🚢 Бункер
• Краткая суть события
"Дословная цитата из поста" — @neftianka
[deep-link на пост]
🏢 Лукойл

🛢 Масла
— нет упоминаний за сутки

✈️ Керосин
...

🏢 Упоминания компаний
• Роснефть: 3 поста
• Газпром: 2 поста
```

Если сообщение >4000 символов — придёт несколькими частями с нумерацией (1/2, 2/2).

---

## 3. Что произойдёт **если что-то сломается**

ALERT-01/02 в действии:

| Сбой | Что увидишь |
|---|---|
| DeepSeek 5xx / timeout | В личку владельца от alert-бота: `{stage: "summarize", message: "...", runId: "...", stack: "..."}`. **В канал Заказчика тишина.** |
| Zod-схема не сошлась после retry | То же, `stage: "summarize"`. Канал Заказчика чистый. |
| Telegram FloodWait | Алерт `stage: "deliver"`. Сводка не уходит. |
| Любой unhandled reject | `stage: "tick"`, alert падает в личку за <60 секунд. |

Если упадёт сам alert-бот (плохой токен, сеть) — внутренний `try/catch` в [src/run.ts:30](../src/run.ts#L30) (D-15) проглотит ошибку, процесс не упадёт, просто в stdout будет warn.

---

## 4. Как проверить что Core Value соблюдается (ручной тест за 2 минуты)

Сравни любую цитату из канала Заказчика с исходным постом:

```bash
# Возьми из data/output/*.md любую цитату в кавычках
grep -F '"искомая цитата"' data/raw/2026-04-26.json
```

Должно совпасть **байт-в-байт** в поле `text` соответствующего поста. Это сердце v3.0 — `verifyExtractiveness` в [src/summarize.ts](../src/summarize.ts) гарантирует это машинно (если LLM выдумает цитату — она дропнется и `postsDropped` увеличится).

---

## 5. Дальнейший GSD-pipeline

Сейчас ты в точке: **Phase 1 verified static, status `human_needed`** (3 пункта в `01-HUMAN-UAT.md` ждут VPS-смока). Дальше:

```
┌─ СЕЙЧАС ───────────────────────────────────────┐
│ Phase 1 status: human_needed                   │
│ ROADMAP.md:    1. Code — 1/1 plans, не помечен │
│                как Complete                     │
└────────────────────────────────────────────────┘
              │
              ▼
   локальный smoke (этот npm start)
              │
   ┌──────────┴──────────┐
   │                     │
 успех               что-то сломалось
   │                     │
   ▼                     ▼
"approved"        опиши проблему
в чат                    │
   │                     ▼
   │              /gsd-debug 01     ← диагностика
   │              или /gsd-plan-phase 01 --gaps
   │              ← gap closure plan
   ▼
 Я закрываю Phase 1:
 • update ROADMAP (1. Code → Complete)
 • update STATE.md (Current Position → Phase 2)
 • update REQUIREMENTS.md (14 REQ → verified)
 • update PROJECT.md
              │
              ▼
        Деплой на VPS
   (это уже руками, не GSD)
   • git push
   • на VPS: npm install, pm2 start
   • cron / pm2 restart on schedule
              │
              ▼
   7 календарных дней прогонов
   ← Phase 2 «Accept» не может стартовать
     раньше, потому что её SC требуют
     7 файлов в data/output/ с подряд
     идущими датами
              │
              ▼
   /gsd-discuss-phase 2  (если нужно
       уточнить acceptance-пакет)
   /gsd-plan-phase 2     (создаст plan
       для сборки acceptance/ — Отчёт,
       7 скриншотов, pm2-логи)
   /gsd-execute-phase 2  (выполнит plan)
              │
              ▼
   Передача acceptance/ Заказчику
   → подписание Акта Этапа 1
   → второй платёж 275к
   → /gsd-complete-milestone (закрывает v3.0)
```

---

## TL;DR

1. Допиши `BOT_TOKEN_ALERTS` + `ALERTS_CHAT_ID` в `.env` (5 минут).
2. `npm start` — увидишь логи, файлы в `data/`, сообщение в канале Заказчика.
3. Сравни одну цитату из канала с `data/raw/*.json` — это проверка Core Value.
4. Скажи "approved" — я закрою Phase 1 в GSD-системе.
5. Деплой на VPS → 7 дней прогонов → `/gsd-plan-phase 2` для acceptance-пакета.

---------

/gsd:plant-seed "v4.0: Verification layer для Этапа 2 — сверка по официальным сайтам Роснефть/Лукойл/Газпром, ФАС, Минэнерго. Триггер: после v3.0 ship + Акт Этапа 1"
/gsd:plant-seed "v5.0: Дашборды + Bitsab integration. Триггер: после v4.0 ship"
/gsd:plant-seed "v6.0: Acceptance Этапа 2 — отчёт, демо, подписание Акта на 200к. Триггер: после v5.0 ship"
/gsd:plant-seed "v7.0: Training package для 4 сессий обучения команды Заказчика. Триггер: после v6.0 ship и за 4 недели до 22.07.2026"

----------

Один тактический совет: между v3.0 и v4.0 не рвись сразу в код. У тебя 7 суток smoke — потрать их на /gsd:research-phase 4 для верификационного слоя (изучить, какие у Роснефти/Лукойла/Газпрома RSS/sitemap, есть ли API у ФАС). Это бесплатная работа GSD-агентов параллельно с pacing-режимом v3.0, и ты войдёшь в v4.0 уже с готовым RESEARCH.md.