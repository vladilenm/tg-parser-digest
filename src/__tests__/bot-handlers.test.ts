// src/__tests__/bot-handlers.test.ts — Vitest для bot-handlers (Phase 2 BOT-01..04).
// Покрывает: parseAllowlist, normalizeUsername, parseRemoveCallbackData,
// addChannel/removeChannel/listChannels CRUD-обёртки (с mock'нутым mutate),
// handleCommand (allowlist + /channels + /add_channel + /remove_channel),
// handleCallbackQuery (allowlist + confirm + cancel + idempotent).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseAllowlist,
  normalizeUsername,
  parseRemoveCallbackData,
  addChannel,
  removeChannel,
  listChannels,
  handleCommand,
  handleCallbackQuery,
} from "../bot.js";
import { loadChannels, mutate, type ChannelEntry } from "../channels-store.js";

// vi.mock — ОДНА точка перехвата channels-store. Все вызовы loadChannels/mutate
// из src/bot.ts (через прямой import) попадают в эти моки.
vi.mock("../channels-store.js", () => ({
  loadChannels: vi.fn(),
  mutate: vi.fn(),
  saveChannels: vi.fn(),
}));

// Изолируем bot-handlers от реального data/uploads/ — иначе findLatestWeekWithUploads
// найдёт настоящие dev-загрузки и /bitum_preview пойдёт по happy-path вместо empty-week.
// Phase 4 wave 5: bitum/storage заменил upload/storage; mock'аем оба для надёжности.
vi.mock("../upload/storage.js", () => ({
  findLatestWeekWithUploads: vi.fn(() => null),
  listWeek: vi.fn(() => ({ hasPrices: false, hasFca: false, hasVolumes: false, lastRunAt: null })),
  isoWeekFolder: vi.fn(() => "2026-W21"),
  saveUpload: vi.fn(),
  writeLastRun: vi.fn(),
}));
vi.mock("../bitum/storage.js", () => ({
  findLatestWeekWithUploads: vi.fn(() => null),
  listWeekV5: vi.fn(() => ({
    week: "2026-W21",
    hasBirzhaPrices: false,
    hasBirzhaVolumes: false,
    hasFcaSellers: false,
    hasAllPrices: false,
    hasBitumPriceNew: false,
    lastRunAt: null,
    allPresent: false,
    presentCount: 0,
  })),
  isoWeekFolder: vi.fn(() => "2026-W21"),
  saveUpload: vi.fn(),
  writeLastRun: vi.fn(),
  weekDir: vi.fn((w: string) => `/tmp/${w}`),
  resetWeek: vi.fn(() => []),
}));

const mockedLoadChannels = vi.mocked(loadChannels);
const mockedMutate = vi.mocked(mutate);

// =============================================================================
// Helpers (W-6: ОДИН helper для подмены текущего состояния channels.json внутри mutate(fn)).
// =============================================================================

// WR-03: захватываем возвращаемое значение fn — production mutate() пишет на диск
// именно его (channels-store.ts:113-120). Без этого тесты проходят зелёными
// даже если addChannel/removeChannel вернёт неправильный массив, лишь бы
// мутировал closure'овый `result`. Захват lastWrittenChannels позволяет проверить
// фактическое финальное состояние channels.json (как в production).
let lastWrittenChannels: ChannelEntry[] | null = null;

// W-6: единый helper для подмены текущего состояния channels.json внутри mutate(fn).
// Никаких альтернативных подходов — все CRUD-обёртки и handler'ы тестируются через него.
function withCurrentChannels(channels: ChannelEntry[]): void {
  lastWrittenChannels = null;
  mockedMutate.mockImplementation(async (fn) => {
    // Имитируем production-семантику mutate: захватываем next и пишем на «диск».
    const next = await fn(channels);
    lastWrittenChannels = next;
  });
}

// Выборка из всех fetch-вызовов те, чей URL содержит указанный method (sendMessage,
// editMessageText и т.п.). Возвращает массив parsed-bodies.
function fetchCallsTo(method: string): Array<Record<string, unknown>> {
  const fetchMock = vi.mocked(globalThis.fetch);
  return fetchMock.mock.calls
    .filter(([url]) => typeof url === "string" && url.includes(`/${method}`))
    .map(([, init]) =>
      JSON.parse(((init as RequestInit | undefined)?.body as string) ?? "{}")
    );
}

// I-2: spy на console.log для проверки D-08 формата лога `[bot] denied:`.
// logger.info → console.log с timestamp+префиксом (см. src/logger.ts), поэтому
// `[bot] denied:` лежит во втором аргументе console.log (после "[ts] [info]").
// Тип spy объявлен через ReturnType от vi.spyOn без явных generic'ов — vitest 4
// использует Methods<Required<T>> ограничение, которое плохо работает с lib.dom Console.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consoleLogSpy: any;

// I-2: helper для проверки что в console.log где-то засветилось `[bot] denied:`.
// Универсальный аргумент-сканер: любой аргумент любого вызова.
function consoleLogContains(needle: string): boolean {
  const calls = consoleLogSpy.mock.calls as unknown[][];
  return calls.some((call) =>
    call.some(
      (arg) => typeof arg === "string" && arg.includes(needle)
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // vi.stubGlobal('fetch', ...): подменяем global fetch на vitest mock — все вызовы
  // tgFetch внутри bot.ts попадают в этот mock, ответ 200 OK с пустым result.
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, result: [] }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  // Default: пустой channels list — переопределяется в каждом тесте через withCurrentChannels.
  withCurrentChannels([]);
  mockedLoadChannels.mockReturnValue([]);
});

// =============================================================================
// parseAllowlist (BOT-04)
// =============================================================================

describe("parseAllowlist (BOT-04)", () => {
  it("возвращает пустой Set при undefined", () => {
    expect(parseAllowlist(undefined)).toEqual(new Set());
  });

  it("возвращает пустой Set при пустой строке", () => {
    expect(parseAllowlist("")).toEqual(new Set());
  });

  it('парсит "12345,67890" в Set с двумя числами', () => {
    expect(parseAllowlist("12345,67890")).toEqual(new Set([12345, 67890]));
  });

  it("trim применяется к каждому токену", () => {
    expect(parseAllowlist("  12345 , 67890  ")).toEqual(
      new Set([12345, 67890])
    );
  });

  it("нечисловые токены отсеиваются", () => {
    expect(parseAllowlist("abc,12345")).toEqual(new Set([12345]));
  });

  it('"12345abc" отбрасывается (parseInt strict, WR-01)', () => {
    // Number.parseInt("12345abc", 10) возвращает 12345 — это бы тихо расширило
    // allowlist на ошибочное число. Strict regex `/^[1-9]\d*$/` отсекает такие токены.
    expect(parseAllowlist("12345abc")).toEqual(new Set());
  });

  it('"12345abc,67890" → только 67890 (префиксное число с буквами отброшено, WR-01)', () => {
    expect(parseAllowlist("12345abc,67890")).toEqual(new Set([67890]));
  });

  it("0 и отрицательные числа отсеиваются (n > 0)", () => {
    expect(parseAllowlist("0,-1,12345")).toEqual(new Set([12345]));
  });

  it("Set дедуплицирует одинаковые id", () => {
    const result = parseAllowlist("12345,12345");
    expect(result.size).toBe(1);
    expect(result.has(12345)).toBe(true);
  });

  it("принимает большие positive numeric user.id (Telegram использует 9-10 цифр)", () => {
    // W-2: real-world Telegram user.id могут быть 9-10 значными числами.
    expect(parseAllowlist("7382916482")).toEqual(new Set([7382916482]));
  });
});

// =============================================================================
// normalizeUsername
// =============================================================================

describe("normalizeUsername (regex 5-32 chars, strip @)", () => {
  it('"@durov" → "durov" (strip @)', () => {
    expect(normalizeUsername("@durov")).toBe("durov");
  });

  it('"durov" → "durov" (без @ тоже принимается)', () => {
    expect(normalizeUsername("durov")).toBe("durov");
  });

  it('"  @ch_name123  " → "ch_name123" (trim + strip @)', () => {
    expect(normalizeUsername("  @ch_name123  ")).toBe("ch_name123");
  });

  it('"abc" → null (4 символа мало, минимум 5)', () => {
    expect(normalizeUsername("abc")).toBeNull();
  });

  it('"1abcde" → null (начинается с цифры)', () => {
    expect(normalizeUsername("1abcde")).toBeNull();
  });

  it('"abcde" → "abcde" (5 символов — минимум)', () => {
    expect(normalizeUsername("abcde")).toBe("abcde");
  });

  it("32-символьный валидный username возвращён", () => {
    const u32 = "a" + "b".repeat(31); // 32 символа, начинается с буквы
    expect(u32.length).toBe(32);
    expect(normalizeUsername(u32)).toBe(u32);
  });

  it("33-символьный → null (превышен лимит)", () => {
    const u33 = "a" + "b".repeat(32); // 33 символа
    expect(u33.length).toBe(33);
    expect(normalizeUsername(u33)).toBeNull();
  });

  it('"abc-def" → null (дефис не разрешён)', () => {
    expect(normalizeUsername("abc-def")).toBeNull();
  });
});

// =============================================================================
// parseRemoveCallbackData (BOT-03 D-11)
// =============================================================================

describe("parseRemoveCallbackData (BOT-03 D-11 callback_data format)", () => {
  it('"rm:durov:confirm" → { username: "durov", action: "confirm" }', () => {
    expect(parseRemoveCallbackData("rm:durov:confirm")).toEqual({
      username: "durov",
      action: "confirm",
    });
  });

  it('"rm:durov:cancel" → { username: "durov", action: "cancel" }', () => {
    expect(parseRemoveCallbackData("rm:durov:cancel")).toEqual({
      username: "durov",
      action: "cancel",
    });
  });

  it('"rm:durov:other" → null (action не confirm/cancel)', () => {
    expect(parseRemoveCallbackData("rm:durov:other")).toBeNull();
  });

  it('"other:durov:confirm" → null (неверный prefix)', () => {
    expect(parseRemoveCallbackData("other:durov:confirm")).toBeNull();
  });

  it('"rm:durov" → null (неполный формат, только 2 части)', () => {
    expect(parseRemoveCallbackData("rm:durov")).toBeNull();
  });

  it('"rm::confirm" → null (пустой username)', () => {
    expect(parseRemoveCallbackData("rm::confirm")).toBeNull();
  });

  it('"" → null (пустая строка)', () => {
    expect(parseRemoveCallbackData("")).toBeNull();
  });
});

// =============================================================================
// addChannel CRUD wrapper (BOT-02)
// =============================================================================

describe("addChannel CRUD wrapper (BOT-02 idempotent)", () => {
  it("возвращает 'added' и записывает новый канал в channels.json (WR-03)", async () => {
    withCurrentChannels([]);
    const result = await addChannel("newch");
    expect(result).toBe("added");
    // I-3: проверяем что mutate вызван 1 раз и аргумент — функция.
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    expect(typeof mockedMutate.mock.calls[0][0]).toBe("function");
    // WR-03: финальное состояние channels.json содержит новый канал.
    expect(lastWrittenChannels).toEqual([{ username: "newch" }]);
  });

  it("возвращает 'exists' и не меняет список если канал уже в списке (idempotent, WR-03)", async () => {
    withCurrentChannels([{ username: "existing" }]);
    const result = await addChannel("existing");
    expect(result).toBe("exists");
    // I-3: mutate всё равно вызван (mutex берётся), но fn не меняет channels.
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    // WR-03: финальное состояние не изменилось.
    expect(lastWrittenChannels).toEqual([{ username: "existing" }]);
  });
});

// =============================================================================
// removeChannel CRUD wrapper (BOT-03)
// =============================================================================

describe("removeChannel CRUD wrapper (BOT-03 idempotent)", () => {
  it("возвращает 'removed' и удаляет нужный канал из списка (WR-03)", async () => {
    withCurrentChannels([{ username: "present" }, { username: "other" }]);
    const result = await removeChannel("present");
    expect(result).toBe("removed");
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    // WR-03: на «диск» уходит массив без удалённого канала.
    expect(lastWrittenChannels).toEqual([{ username: "other" }]);
  });

  it("возвращает 'missing' и сохраняет список без изменений (D-14, idempotent, WR-03)", async () => {
    withCurrentChannels([{ username: "other" }]);
    const result = await removeChannel("absent");
    expect(result).toBe("missing");
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    // WR-03: финальное состояние совпадает с исходным.
    expect(lastWrittenChannels).toEqual([{ username: "other" }]);
  });
});

// =============================================================================
// listChannels (BOT-01)
// =============================================================================

describe("listChannels (BOT-01)", () => {
  it("возвращает 'Список каналов пуст' при пустом массиве", () => {
    mockedLoadChannels.mockReturnValue([]);
    expect(listChannels()).toBe("Список каналов пуст");
  });

  it("возвращает форматированный список с нумерацией и счётчиком", () => {
    mockedLoadChannels.mockReturnValue([
      { username: "a" },
      { username: "b" },
    ]);
    const result = listChannels();
    expect(result).toContain("Каналов: 2");
    expect(result).toContain("1. @a");
    expect(result).toContain("2. @b");
  });
});

// =============================================================================
// handleCommand allowlist (BOT-04, B-5: отдельный describe)
// =============================================================================

describe("handleCommand allowlist (BOT-04 D-07/D-08)", () => {
  it("отказывает не-allowlist пользователю молча (silent ignore + log [bot] denied:)", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 999 }, // не в allowlist
      text: "/channels",
    };
    await handleCommand("token", msg, allowlist);
    // Silent ignore: fetch НЕ вызван (никакого sendMessage).
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // I-2 / D-08: проверяем формат лога — `[bot] denied:` идёт во втором аргументе console.log
    // (logger печатает timestamp+level в первом, msg во втором). consoleLogSpy на console.log,
    // т.к. log.info → console.log (см. src/logger.ts).
    expect(consoleLogContains("[bot] denied:")).toBe(true);
  });

  it("игнорирует не-команду (text без /) — даже от allowlist", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "Hello, bot",
    };
    await handleCommand("token", msg, allowlist);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// handleCommand /channels (BOT-01, B-5: отдельный describe)
// =============================================================================

describe("handleCommand /channels (BOT-01)", () => {
  it("allowlist-пользователь видит список каналов", async () => {
    mockedLoadChannels.mockReturnValue([
      { username: "a" },
      { username: "b" },
    ]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/channels",
    };
    await handleCommand("token", msg, allowlist);
    // sendMessage вызван с текстом списка.
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBeGreaterThanOrEqual(1);
    expect(sendCalls[0].text).toContain("Каналов:");
    // D-09: reply_to_message_id присутствует.
    expect(sendCalls[0].reply_to_message_id).toBe(1);
    expect(sendCalls[0].chat_id).toBe(555);
    // BOT-UI-01: sendReply теперь по дефолту прикладывает MAIN_KEYBOARD (reply-keyboard 2×2).
    const rm = sendCalls[0].reply_markup as {
      keyboard?: Array<Array<{ text: string }>>;
      resize_keyboard?: boolean;
      is_persistent?: boolean;
    };
    expect(rm).toBeDefined();
    expect(rm.keyboard).toBeDefined();
    expect(rm.keyboard).toEqual([
      [{ text: "📊 Статус загрузок" }, { text: "🧠 Сделать сводку" }],
      [{ text: "📋 Каналы новостей" }, { text: "❓ Помощь" }],
    ]);
    expect(rm.resize_keyboard).toBe(true);
    expect(rm.is_persistent).toBe(true);
  });

  it("/channels с suffix @botname парсится как /channels", async () => {
    mockedLoadChannels.mockReturnValue([{ username: "a" }]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 2,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/channels@MyBot",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("Каналов:");
  });
});

// =============================================================================
// handleCommand /add_channel (BOT-02)
// =============================================================================

describe("handleCommand /add_channel (BOT-02)", () => {
  it("/add_channel @validuser с пустым current → mutate вызван и текст 'Добавлен'", async () => {
    withCurrentChannels([]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/add_channel @validuser",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("Добавлен @validuser");
  });

  it("/add_channel @existinguser когда уже есть → ответ 'уже в списке'", async () => {
    withCurrentChannels([{ username: "existinguser" }]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/add_channel @existinguser",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("уже в списке");
  });

  it("/add_channel без аргумента → usage-подсказка", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/add_channel",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedMutate).not.toHaveBeenCalled();
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("Использование: /add_channel");
  });

  it("/add_channel @bad (3 символа) → ответ 'Невалидный username'", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/add_channel @bad",
    };
    await handleCommand("token", msg, allowlist);
    expect(mockedMutate).not.toHaveBeenCalled();
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("Невалидный username");
  });
});

// =============================================================================
// handleCommand /remove_channel (BOT-03 — показ inline-keyboard)
// =============================================================================

describe("handleCommand /remove_channel (BOT-03 inline-keyboard)", () => {
  it("/remove_channel @durov → fetch с inline_keyboard содержит rm:durov:confirm И rm:durov:cancel", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/remove_channel @durov",
    };
    await handleCommand("token", msg, allowlist);
    // mutate НЕ вызван на этапе показа кнопок — только при нажатии confirm.
    expect(mockedMutate).not.toHaveBeenCalled();
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    const body = sendCalls[0];
    expect(body.text).toContain("Удалить @durov");
    // reply_markup.inline_keyboard содержит две кнопки с правильными callback_data.
    const replyMarkup = body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    expect(replyMarkup.inline_keyboard).toBeDefined();
    const flatButtons = replyMarkup.inline_keyboard.flat();
    const callbackData = flatButtons.map((b) => b.callback_data);
    expect(callbackData).toContain("rm:durov:confirm");
    expect(callbackData).toContain("rm:durov:cancel");
    // BOT-UI-01: для inline-confirm сообщения reply_markup остаётся inline_keyboard,
    // а reply-keyboard (поле `keyboard`) НЕ перезатёрт (Telegram принял бы только inline).
    expect(
      (replyMarkup as unknown as { keyboard?: unknown }).keyboard
    ).toBeUndefined();
  });

  it("/remove_channel без аргумента → usage-подсказка", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/remove_channel",
    };
    await handleCommand("token", msg, allowlist);
    const sendCalls = fetchCallsTo("sendMessage");
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0].text).toContain("Использование: /remove_channel");
  });
});

// =============================================================================
// handleCommand /start (BOT-UI-03)
// =============================================================================

describe("handleCommand /start (BOT-UI-03)", () => {
  it("/start от allowlist → приветствие + reply_markup с keyboard 2×2", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/start",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    expect(calls.length).toBe(1);
    expect(calls[0].text).toMatch(/Привет/i);
    const rm = calls[0].reply_markup as {
      keyboard?: Array<Array<{ text: string }>>;
    };
    expect(rm.keyboard).toBeDefined();
    expect(rm.keyboard).toHaveLength(2);
    expect((rm.keyboard as Array<Array<{ text: string }>>)[0][0].text).toBe(
      "📊 Статус загрузок"
    );
  });

  it("/start@MyBot парсится как /start", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/start@MyBot",
    };
    await handleCommand("token", msg, allowlist);
    expect(fetchCallsTo("sendMessage").length).toBe(1);
  });

  it("/start от non-allowlist → silent ignore + log [bot] denied: cmd=/start", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 999 },
      text: "/start",
    };
    await handleCommand("token", msg, allowlist);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(consoleLogContains("[bot] denied:")).toBe(true);
  });
});

// =============================================================================
// handleCommand /help (BOT-UI-04)
// =============================================================================

describe("handleCommand /help (BOT-UI-04)", () => {
  it("/help → инструкция содержит ключевые слова (xlsx, /channels)", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "/help",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    expect(calls.length).toBe(1);
    const t = calls[0].text as string;
    expect(t).toMatch(/xlsx/i);
    expect(t).toContain("/channels");
  });
});

// =============================================================================
// handleCommand emoji-button mapping (BOT-UI-05)
// =============================================================================

describe("handleCommand emoji-button mapping (BOT-UI-05)", () => {
  it("'📋 Каналы новостей' маршрутизируется как /channels", async () => {
    mockedLoadChannels.mockReturnValue([{ username: "a" }]);
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "📋 Каналы новостей",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    expect(calls.length).toBe(1);
    expect(calls[0].text).toContain("Каналов:");
  });

  it("'❓ Помощь' маршрутизируется как /help (инструкция содержит xlsx)", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "❓ Помощь",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    expect(calls.length).toBe(1);
    expect(calls[0].text).toMatch(/xlsx/i);
  });

  it("'📊 Статус загрузок' маршрутизируется как /bitum_status (Phase 4)", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "📊 Статус загрузок",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    expect(calls.length).toBe(1);
    expect(calls[0].text).toMatch(/Битум-неделя/);
  });

  it("'🧠 Сделать сводку' маршрутизируется как /bitum_preview (Phase 4)", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "🧠 Сделать сводку",
    };
    await handleCommand("token", msg, allowlist);
    const calls = fetchCallsTo("sendMessage");
    // bitum_preview шлёт progress "📊 Готовлю превью отчёта…" + warning
    const allTexts = calls.map((c) => c.text as string).join("\n");
    expect(allTexts).toMatch(/файлов не загружено/i);
  });

  it("обычное текстовое сообщение без / и без эмодзи-кнопки → ignored", async () => {
    const allowlist = new Set([111]);
    const msg = {
      message_id: 1,
      chat: { id: 555 },
      from: { id: 111 },
      text: "просто привет",
    };
    await handleCommand("token", msg, allowlist);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// handleCallbackQuery allowlist (BOT-04, B-5: отдельный describe)
// =============================================================================

describe("handleCallbackQuery allowlist (BOT-04 D-07/D-12)", () => {
  it("отказывает не-allowlist пользователю silent (без answerCallbackQuery)", async () => {
    const allowlist = new Set([111]);
    const cb = {
      id: "cb1",
      from: { id: 999 }, // не в allowlist
      message: { message_id: 1, chat: { id: 555 } },
      data: "rm:durov:confirm",
    };
    await handleCallbackQuery("token", cb, allowlist);
    // D-07: НИКАКОГО fetch (даже answerCallbackQuery).
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // D-08: лог `[bot] denied: from=N cmd=callback:DATA` — формат из бота.
    expect(consoleLogContains("[bot] denied:")).toBe(true);
  });
});

// =============================================================================
// handleCallbackQuery confirm (BOT-03)
// =============================================================================

describe("handleCallbackQuery confirm (BOT-03 D-13/D-14 idempotent)", () => {
  it("confirm на отсутствующий канал → editMessageText 'не найден в списке (возможно, уже удалён)' (D-14)", async () => {
    withCurrentChannels([{ username: "other" }]);
    const allowlist = new Set([111]);
    const cb = {
      id: "cb1",
      from: { id: 111 },
      message: { message_id: 1, chat: { id: 555 } },
      data: "rm:absent:confirm",
    };
    await handleCallbackQuery("token", cb, allowlist);
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    const editTextCalls = fetchCallsTo("editMessageText");
    expect(editTextCalls.length).toBe(1);
    expect(editTextCalls[0].text).toContain(
      "не найден в списке (возможно, уже удалён)"
    );
  });

  it("confirm на присутствующий канал → editMessageText 'Удалён @durov'", async () => {
    withCurrentChannels([{ username: "durov" }]);
    const allowlist = new Set([111]);
    const cb = {
      id: "cb1",
      from: { id: 111 },
      message: { message_id: 1, chat: { id: 555 } },
      data: "rm:durov:confirm",
    };
    await handleCallbackQuery("token", cb, allowlist);
    expect(mockedMutate).toHaveBeenCalledTimes(1);
    const editTextCalls = fetchCallsTo("editMessageText");
    expect(editTextCalls.length).toBe(1);
    expect(editTextCalls[0].text).toContain("Удалён @durov");
    // D-13: editMessageReplyMarkup тоже вызван (убираем кнопки).
    const editMarkupCalls = fetchCallsTo("editMessageReplyMarkup");
    expect(editMarkupCalls.length).toBe(1);
    const replyMarkup = editMarkupCalls[0].reply_markup as {
      inline_keyboard: unknown[];
    };
    expect(replyMarkup.inline_keyboard).toEqual([]);
  });
});

// =============================================================================
// handleCallbackQuery cancel (BOT-03)
// =============================================================================

describe("handleCallbackQuery cancel (BOT-03 D-13)", () => {
  it("cancel → mutate НЕ вызван, editMessageText 'Отмена удаления @durov'", async () => {
    const allowlist = new Set([111]);
    const cb = {
      id: "cb1",
      from: { id: 111 },
      message: { message_id: 1, chat: { id: 555 } },
      data: "rm:durov:cancel",
    };
    await handleCallbackQuery("token", cb, allowlist);
    // mutate НЕ должен вызываться при cancel.
    expect(mockedMutate).not.toHaveBeenCalled();
    const editTextCalls = fetchCallsTo("editMessageText");
    expect(editTextCalls.length).toBe(1);
    expect(editTextCalls[0].text).toContain("Отмена удаления @durov");
    // D-13: кнопки убраны.
    const editMarkupCalls = fetchCallsTo("editMessageReplyMarkup");
    expect(editMarkupCalls.length).toBe(1);
  });

  it("неизвестный callback format → answerCallbackQuery без действий (graceful no-op)", async () => {
    const allowlist = new Set([111]);
    const cb = {
      id: "cb1",
      from: { id: 111 },
      message: { message_id: 1, chat: { id: 555 } },
      data: "unknown:format",
    };
    await handleCallbackQuery("token", cb, allowlist);
    // mutate НЕ вызван.
    expect(mockedMutate).not.toHaveBeenCalled();
    // answerCallbackQuery вызван (без actions).
    const ackCalls = fetchCallsTo("answerCallbackQuery");
    expect(ackCalls.length).toBe(1);
    // editMessage* НЕ вызваны.
    expect(fetchCallsTo("editMessageText").length).toBe(0);
    expect(fetchCallsTo("editMessageReplyMarkup").length).toBe(0);
  });
});
