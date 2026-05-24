// src/bitum/parsers/fca-sellers.ts — парсер «Битум таблица продавцы» (FCA).
// Парсит ОРИГИНАЛЬНЫЙ файл (docs/examples/BITUM — таблица продавцы.xlsx).
// Структура (verified 2026-05-22):
//   row 1 = шапка: A="Дата", B="Регион", C="Пункт отгрузки", D="БНД"
//   row 2..N = данные: A=дата (per-row), B=регион, C=НПЗ/продавец, D=цена в руб/т
// В источнике НЕТ колонок prev/Δ. Парсер возвращает плоский snapshot per row.
// Дельта считается на уровне analyzer'a: группировка по pointOfShipment,
// ≥2 даты → priceFrom = первая, priceTo = последняя, deltaWeek = разница;
// единичные продавцы пропускаются (см. analyzer.ts movementsFromFca).

import { z } from "zod";
import {
  BITUM_MAX_ROWS,
  loadFirstSheet,
  excelDateToIso,
  cellNumber,
  cellString,
} from "./shared.js";
import type { RefineriesDict } from "../refineries.js";
import { normalizeRefinery } from "../refineries.js";
import type {
  ParsedFcaRow,
  ParserError,
  ParserResult,
} from "../types.js";

const HEADER_ROW = 1;
const COL_DATE = 1; // A
const COL_REGION = 2; // B
const COL_REFINERY = 3; // C (Пункт отгрузки)
const COL_PRICE = 4; // D (БНД, руб/т)
// Колонка «в отчет» ищется ДИНАМИЧЕСКИ по заголовку — заказчик 2026-05-24
// присылал файл где col E пустая, а «в отчет» в col F (иногда возникает
// пустая колонка между БНД и priority). Поиск по тексту устойчив к таким
// сдвигам. Optional — если заголовок не найден, priority undefined.
const PRIORITY_HEADER_RE = /в\s*отч[её]т/i;
const PRIORITY_SEARCH_MAX_COL = 20; // защитный потолок

const RowSchema = z.object({
  date: z.string().min(8),
  refineryCanonical: z.string(),
  refineryRaw: z.string(),
  region: z.string(),
  pointOfShipment: z.string(),
  priceRub: z.number().nonnegative(),
  deltaWeek: z.number(), // 0 в источнике; реальная Δ считается в analyzer
  priority: z.number().nonnegative().optional(),
});

export async function parseFcaSellers(
  buffer: Buffer,
  dict: RefineriesDict
): Promise<ParserResult<ParsedFcaRow>> {
  const rows: ParsedFcaRow[] = [];
  const errors: ParserError[] = [];
  let sheetName = "";
  let cellRange = "";
  try {
    const { sheet, sheetName: name } = await loadFirstSheet(buffer);
    sheetName = name;
    const rowCount = sheet.rowCount;
    if (rowCount > BITUM_MAX_ROWS) {
      return {
        rows: [],
        errors: [{ rowNum: 0, reason: `too many rows (>${BITUM_MAX_ROWS})` }],
        meta: {
          fileType: "fca_sellers",
          sheetName,
          cellRange: "",
          rowsCount: 0,
        },
      };
    }
    // Динамический поиск колонки «в отчет» по заголовку — в реальных файлах
    // оператора между БНД (col D) и приоритетом может быть пустая колонка,
    // т.е. «в отчет» сидит в col F, а не E. Ищем по regex в HEADER_ROW.
    const headerRow = sheet.getRow(HEADER_ROW);
    let priorityCol: number | null = null;
    for (let c = COL_PRICE + 1; c <= PRIORITY_SEARCH_MAX_COL; c++) {
      const text = cellString(headerRow.getCell(c));
      if (text && PRIORITY_HEADER_RE.test(text)) {
        priorityCol = c;
        break;
      }
    }

    let lastDataRow = HEADER_ROW;
    for (let r = HEADER_ROW + 1; r <= rowCount; r++) {
      const dataRow = sheet.getRow(r);
      const dateIso = excelDateToIso(dataRow.getCell(COL_DATE).value);
      if (!dateIso) {
        // Пустые строки пропускаем тихо; строки с данными без даты → error.
        const hasAnyData =
          cellString(dataRow.getCell(COL_REFINERY)) !== "" ||
          cellNumber(dataRow.getCell(COL_PRICE)) !== null;
        if (hasAnyData) {
          errors.push({ rowNum: r, reason: "missing/invalid date in col A" });
        }
        continue;
      }
      const refineryRaw = cellString(dataRow.getCell(COL_REFINERY));
      if (!refineryRaw) continue;
      const region = cellString(dataRow.getCell(COL_REGION));
      const price = cellNumber(dataRow.getCell(COL_PRICE));
      if (price === null) {
        errors.push({ rowNum: r, reason: "missing price (col D)" });
        continue;
      }
      const norm = normalizeRefinery(refineryRaw, dict);
      // Priority из динамически найденной колонки «в отчет». Если колонки нет
      // в файле — priority всегда undefined (backward-compat). Если есть, но
      // ячейка пустая / 0 / нечисло — undefined для этой строки.
      const priorityRaw =
        priorityCol !== null ? cellNumber(dataRow.getCell(priorityCol)) : null;
      const priority =
        priorityRaw !== null && priorityRaw > 0 ? priorityRaw : undefined;
      const candidate: ParsedFcaRow = {
        date: dateIso,
        refineryCanonical: norm.canonical,
        refineryRaw,
        region,
        pointOfShipment: refineryRaw,
        priceRub: price,
        deltaWeek: 0, // считается на уровне analyzer'a из группировки по pointOfShipment
        priority,
      };
      const parsed = RowSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push({
          rowNum: r,
          reason: `validation failed: ${parsed.error.message.slice(0, 100)}`,
        });
        continue;
      }
      rows.push(parsed.data);
      lastDataRow = r;
    }
    cellRange = `A${HEADER_ROW + 1}:E${lastDataRow}`;
  } catch (err) {
    errors.push({ rowNum: 0, reason: (err as Error).message });
  }
  return {
    rows,
    errors,
    meta: {
      fileType: "fca_sellers",
      sheetName,
      cellRange,
      rowsCount: rows.length,
    },
  };
}
