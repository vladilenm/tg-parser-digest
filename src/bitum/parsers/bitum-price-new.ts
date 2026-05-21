// src/bitum/parsers/bitum-price-new.ts — BITUM-PARSE-05.
// Snapshot на одну дату. Реальный формат (algoritm.md §4 + docs/examples):
//   Row 1: A=Дата, B=Пункт отгрузки, C=Компания, D=Вид базиса, E=Вид цен,
//          F="БНД - Цена недели", G="БНД - Изменение",
//          H="ПБВ - Цена недели", I="ПБВ - Изменение".
//   Row 2+: данные per НПЗ × компания (опционально с пустыми ценами).
// Snapshot = усреднение по всем строкам с положительной ценой.
//   bnd.price/deltaAbs = average по колонкам F/G (числовые строки),
//   pbv.price/deltaAbs = average по колонкам H/I.
//   deltaAbs текст ("не изм." и т.п.) → 0.
//   deltaPct = (deltaAbs / (price - deltaAbs)) * 100.

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

interface ColumnSet {
  dateCol: number;
  bndPriceCol: number;
  bndChangeCol: number;
  pbvPriceCol: number;
  pbvChangeCol: number;
}

/**
 * Find header columns by name in row 1.
 * Returns null if required price columns are absent.
 */
function findColumns(ws: ExcelJS.Worksheet): ColumnSet | null {
  const headerRow = ws.getRow(1);
  let dateCol = 0;
  let bndPriceCol = 0;
  let bndChangeCol = 0;
  let pbvPriceCol = 0;
  let pbvChangeCol = 0;
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = cellToString(headerRow.getCell(c).value).trim().toLowerCase();
    if (h === "дата") dateCol = c;
    else if (h.includes("бнд")) {
      if (h.includes("цена")) bndPriceCol = c;
      else if (h.includes("изменение")) bndChangeCol = c;
    } else if (h.includes("пбв")) {
      if (h.includes("цена")) pbvPriceCol = c;
      else if (h.includes("изменение")) pbvChangeCol = c;
    }
  }
  if (!bndPriceCol || !pbvPriceCol) return null;
  return { dateCol, bndPriceCol, bndChangeCol, pbvPriceCol, pbvChangeCol };
}

interface Aggregated {
  avgPrice: number;
  avgDelta: number;
  firstPriceCell: string;
  firstDeltaCell: string;
}

function aggregate(
  ws: ExcelJS.Worksheet,
  priceCol: number,
  changeCol: number,
): Aggregated | null {
  const prices: number[] = [];
  const deltas: number[] = [];
  let firstPriceRow = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const price = cellToNumber(row.getCell(priceCol).value);
    if (price == null || price <= 0) continue;
    prices.push(price);
    if (firstPriceRow === 0) firstPriceRow = r;
    const delta = changeCol > 0
      ? cellToNumber(row.getCell(changeCol).value) ?? 0
      : 0;
    deltas.push(delta);
  }
  if (prices.length === 0) return null;
  const avgPrice = prices.reduce((s, x) => s + x, 0) / prices.length;
  const avgDelta = deltas.reduce((s, x) => s + x, 0) / deltas.length;
  return {
    avgPrice: Math.round(avgPrice),
    avgDelta: Math.round(avgDelta),
    firstPriceCell: cellAddress(priceCol, firstPriceRow),
    firstDeltaCell: cellAddress(changeCol || priceCol, firstPriceRow),
  };
}

function findDate(ws: ExcelJS.Worksheet, dateCol: number): Date {
  if (dateCol > 0) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const d = cellToDate(ws.getRow(r).getCell(dateCol).value);
      if (d) return d;
    }
  }
  for (let r = 1; r <= Math.min(3, ws.rowCount); r++) {
    for (let c = 1; c <= Math.min(8, ws.columnCount); c++) {
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

  const cols = findColumns(ws);
  if (!cols) {
    result.errors.push({
      rowNum: 0,
      reason:
        "header row 1 does not contain БНД/ПБВ price columns (expected 'БНД - Цена недели' / 'ПБВ - Цена недели')",
    });
    return result;
  }

  const bnd = aggregate(ws, cols.bndPriceCol, cols.bndChangeCol);
  const pbv = aggregate(ws, cols.pbvPriceCol, cols.pbvChangeCol);
  if (!bnd) {
    result.errors.push({
      rowNum: 0,
      reason: "no rows with valid БНД price",
    });
    return result;
  }
  if (!pbv) {
    result.errors.push({
      rowNum: 0,
      reason: "no rows with valid ПБВ price",
    });
    return result;
  }

  const date = findDate(ws, cols.dateCol);
  const calcPct = (price: number, deltaAbs: number): number => {
    const old = price - deltaAbs;
    if (old === 0) return 0;
    return (deltaAbs / old) * 100;
  };

  const candidate: ParsedBitumPriceNewSnapshot = {
    date,
    bnd: {
      price: bnd.avgPrice,
      deltaAbs: bnd.avgDelta,
      deltaPct: calcPct(bnd.avgPrice, bnd.avgDelta),
      priceCell: bnd.firstPriceCell,
      deltaCell: bnd.firstDeltaCell,
    },
    pbv: {
      price: pbv.avgPrice,
      deltaAbs: pbv.avgDelta,
      deltaPct: calcPct(pbv.avgPrice, pbv.avgDelta),
      priceCell: pbv.firstPriceCell,
      deltaCell: pbv.firstDeltaCell,
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
