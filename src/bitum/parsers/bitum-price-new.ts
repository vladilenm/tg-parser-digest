// src/bitum/parsers/bitum-price-new.ts — BITUM-PARSE-05.
// Snapshot на одну дату. Layout (новый файл от Заказчика, algoritm.md §4):
//   A1+ — заголовки строк, B+ — данные. Колонка F = «Цена недели», G = «Изменение».
//   Строка с БНД (контентом A) → bnd.price = F, bnd.deltaAbs = G.
//   Строка с ПБВ → pbv.price = F, pbv.deltaAbs = G.
// deltaPct вычисляем из (deltaAbs / (price - deltaAbs)) * 100.

import { z } from "zod";
import type ExcelJS from "exceljs";
import type {
  ParsedBitumPriceNewSnapshot,
  ParserResult,
} from "../types.js";
import {
  cellAddress,
  cellToDate,
  cellToNumber,
  cellToString,
  loadWorkbook,
} from "./shared.js";

const CELL_RE = /^[A-Z]+\d+$/;
const SNAPSHOT_SCHEMA = z.object({
  date: z.date(),
  bnd: z.object({
    price: z.number().positive().finite(),
    deltaAbs: z.number().finite(),
    deltaPct: z.number().finite(),
    priceCell: z.string().regex(CELL_RE),
    deltaCell: z.string().regex(CELL_RE),
  }),
  pbv: z.object({
    price: z.number().positive().finite(),
    deltaAbs: z.number().finite(),
    deltaPct: z.number().finite(),
    priceCell: z.string().regex(CELL_RE),
    deltaCell: z.string().regex(CELL_RE),
  }),
});

interface Row {
  price: number;
  deltaAbs: number;
  priceCell: string;
  deltaCell: string;
}

/**
 * Найти строку, в первой колонке которой есть keyword (case-insensitive).
 * Возвращает { price, deltaAbs, priceCell, deltaCell } с real Excel A1-addresses или null.
 */
function findRow(ws: ExcelJS.Worksheet, keyword: string): Row | null {
  const needle = keyword.toLowerCase();
  for (let r = 1; r <= ws.rowCount; r++) {
    const label = cellToString(ws.getRow(r).getCell(1).value)
      .trim()
      .toLowerCase();
    if (label.includes(needle)) {
      const price = cellToNumber(ws.getRow(r).getCell(6).value); // F
      const deltaAbs = cellToNumber(ws.getRow(r).getCell(7).value); // G
      if (price != null && deltaAbs != null) {
        return {
          price,
          deltaAbs,
          priceCell: cellAddress(6, r),
          deltaCell: cellAddress(7, r),
        };
      }
    }
  }
  return null;
}

/**
 * Найти дату snapshot'а: смотрим row 1-3 первых 8 колонок, ищем Date cell.
 * Если нет — return new Date() (текущая дата).
 */
function findDate(ws: ExcelJS.Worksheet): Date {
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 8; c++) {
      const d = cellToDate(ws.getRow(r).getCell(c).value);
      if (d) return d;
    }
  }
  return new Date();
}

export async function parseBitumPriceNew(
  buffer: Buffer,
): Promise<ParserResult<ParsedBitumPriceNewSnapshot>> {
  const result: ParserResult<ParsedBitumPriceNewSnapshot> = {
    rows: [],
    errors: [],
  };
  const wb = await loadWorkbook(buffer);
  const ws = wb.worksheets[0];
  if (!ws) {
    result.errors.push({ rowNum: 0, reason: "workbook has no worksheets" });
    return result;
  }

  const bndRaw = findRow(ws, "бнд");
  const pbvRaw = findRow(ws, "пбв");
  if (!bndRaw) {
    result.errors.push({
      rowNum: 0,
      reason: "no row with 'БНД' label in column A",
    });
    return result;
  }
  if (!pbvRaw) {
    result.errors.push({
      rowNum: 0,
      reason: "no row with 'ПБВ' label in column A",
    });
    return result;
  }

  const date = findDate(ws);
  // deltaPct = deltaAbs / oldPrice * 100; oldPrice = price - deltaAbs
  const calcPct = (price: number, deltaAbs: number): number => {
    const old = price - deltaAbs;
    if (old === 0) return 0;
    return (deltaAbs / old) * 100;
  };

  const candidate: ParsedBitumPriceNewSnapshot = {
    date,
    bnd: {
      price: bndRaw.price,
      deltaAbs: bndRaw.deltaAbs,
      deltaPct: calcPct(bndRaw.price, bndRaw.deltaAbs),
      priceCell: bndRaw.priceCell,
      deltaCell: bndRaw.deltaCell,
    },
    pbv: {
      price: pbvRaw.price,
      deltaAbs: pbvRaw.deltaAbs,
      deltaPct: calcPct(pbvRaw.price, pbvRaw.deltaAbs),
      priceCell: pbvRaw.priceCell,
      deltaCell: pbvRaw.deltaCell,
    },
  };
  const parsed = SNAPSHOT_SCHEMA.safeParse(candidate);
  if (parsed.success) {
    result.rows.push(parsed.data);
  } else {
    result.errors.push({
      rowNum: 0,
      reason: parsed.error.message.slice(0, 300),
    });
  }
  return result;
}
