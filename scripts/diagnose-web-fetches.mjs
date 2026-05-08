// Диагностика — гоняет проблемные URL через тот же undici Agent (allowH2: false),
// что и web-scraper, и печатает error.cause для каждого фейла.
import { Agent } from "undici";

const URLS = [
  "https://oilcapital.ru/",
  "https://neftegaz.ru/news/",
  "https://www.rupec.ru/news/",
  "https://www.gazprom-neft.ru/press-center/news/",
  "https://gazpromneft-sm.ru/press-center",
  "https://gazpromneft-oil.ru/ru/brand/news",
  "https://g-energy.org/ru/brand/news",
  "https://bitum.gazprom-neft.ru/press-center/news/",
  "https://tk418.ru/news/",
  "https://www.tatneft.ru/news",
  "https://nangs.org/news",
];

const dispatcher = new Agent({ allowH2: false, connect: { timeout: 10_000 } });

const headers = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

function dumpErr(err) {
  const lines = [];
  lines.push(`  message: ${err?.message ?? err}`);
  if (err?.code) lines.push(`  code: ${err.code}`);
  if (err?.cause) {
    lines.push(`  cause.name: ${err.cause?.name ?? "?"}`);
    lines.push(`  cause.message: ${err.cause?.message ?? err.cause}`);
    if (err.cause?.code) lines.push(`  cause.code: ${err.cause.code}`);
    if (err.cause?.errors) {
      err.cause.errors.forEach((e, i) =>
        lines.push(`  cause.errors[${i}]: ${e?.code ?? ""} ${e?.message ?? e}`)
      );
    }
  }
  return lines.join("\n");
}

for (const url of URLS) {
  process.stdout.write(`\n=== ${url} ===\n`);
  try {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
      // @ts-ignore
      dispatcher,
    });
    const dur = Date.now() - t0;
    process.stdout.write(
      `  OK status=${res.status} ${dur}ms server="${res.headers.get("server") ?? "?"}" ` +
        `content-type="${res.headers.get("content-type") ?? "?"}"\n`
    );
  } catch (err) {
    process.stdout.write(`  FAIL\n${dumpErr(err)}\n`);
  }
}

await dispatcher.close();
