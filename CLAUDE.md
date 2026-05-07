<!-- GSD:project-start source:PROJECT.md -->
## Project

**tg-parser-demo**

Один исполняемый Node.js-скрипт, который читает 10–15 публичных Telegram-каналов по российскому нефтегазу/нефтехимии за последние 24 часа, прогоняет все посты через DeepSeek и отправляет экстрактивный HTML-дайджест в мой личный закрытый Telegram-канал. Запуск — руками (`npm start`) с рабочей машины, между запусками состояние не хранится.

**Core Value:** За один `npm start` получить в закрытом канале дайджест событий нефтегаза за последние 24 часа, в котором **каждая цитата дословно присутствует в исходном посте** — без галлюцинаций LLM.

// todo: update

### Constraints

- **Tech stack**: Node.js 20.6+ (нужен `--env-file`), TypeScript без шага сборки (`tsx`), ESM, `moduleResolution: bundler`, `strict: true`. Runtime-зависимости ровно три: `telegram` (GramJS), `openai` (DeepSeek через OpenAI-совместимый SDK), `yaml`.
- **Нет БД, нет Redis.** Docker — опционально (для деплоя на Timeweb Cloud Apps); локальная разработка остаётся через `npm start` / `npm run start:once`. node-cron используется внутри daemon-режима для расписания 20:15 MSK.
- **Один оператор, один потребитель** — я запускаю, я читаю в закрытом канале. Никакого multi-tenancy.
- **Telegram API limits**: окно чтения ≤24ч, ≤50 сообщений на канал по умолчанию, задержка между каналами ≥1с + jitter, не чаще одного прогона в 10–15 минут (дисциплина).
- **DeepSeek**: один батч-запрос на прогон, `response_format: json_object`, модель выбирает не более 15 записей в итоговом дайджесте.
- **Telegram Bot API**: лимит 4096 символов на сообщение — режем с запасом ~4000 и нумеруем части.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
