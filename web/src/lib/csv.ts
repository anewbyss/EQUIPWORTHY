// CSV parsing / writing and column auto-mapping for collection imports from
// Moxfield, ManaBox, Deckbox, Dragon Shield, TCGplayer, Delver Lens, etc.

import type { Condition, Finish } from "./types";
import type { BatchLine } from "./batch";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export const csvRow = (cells: string[]) =>
  cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",");

export type Field =
  | "quantity"
  | "name"
  | "set"
  | "collectorNumber"
  | "finish"
  | "condition"
  | "language"
  | "purchasePrice"
  | "scryfallId";

const ALIASES: Record<Field, string[]> = {
  quantity: ["count", "quantity", "qty", "amount", "total quantity", "add to quantity"],
  name: ["name", "card name", "card", "product name", "simple name"],
  set: ["set code", "edition code", "set", "edition", "setcode"],
  collectorNumber: ["collector number", "card number", "number", "collector #", "cn", "col #"],
  finish: ["foil", "finish", "printing", "foil/variant", "is foil"],
  condition: ["condition", "cond"],
  language: ["language", "lang"],
  purchasePrice: ["purchase price", "price bought", "cost", "acquired price", "purchase_price"],
  scryfallId: ["scryfall id", "scryfall_id", "scryfallid"],
};

/** Map each field to a column index by matching header aliases (in priority order). */
export function detectColumns(header: string[]): Partial<Record<Field, number>> {
  const norm = header.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
      if (idx >= 0) {
        out[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return out;
}

export function parseFinish(v: string | undefined): Finish {
  const s = (v ?? "").trim().toLowerCase();
  if (s.includes("etch")) return "etched";
  if (["foil", "true", "yes", "1", "f", "y"].includes(s) || s.startsWith("foil")) return "foil";
  return "nonfoil";
}

export function parseCondition(v: string | undefined): Condition | undefined {
  const s = (v ?? "").trim().toLowerCase().replace(/[_-]/g, " ");
  if (!s) return undefined;
  if (s === "nm" || s.startsWith("near mint") || s === "mint" || s === "m") return "NM";
  if (s === "lp" || s.startsWith("lightly") || s.startsWith("light") || s === "ex" || s === "excellent" || s === "sp" || s.startsWith("slightly")) return "LP";
  if (s === "mp" || s.startsWith("moderately") || s === "good" || s === "gd" || s.startsWith("played") || s === "pl") return "MP";
  if (s === "hp" || s.startsWith("heavily") || s === "poor") return "HP";
  if (s.startsWith("dmg") || s.startsWith("damaged")) return "DMG";
  return undefined;
}

const LANG: Record<string, string> = {
  english: "en", japanese: "ja", german: "de", french: "fr", italian: "it", spanish: "es",
  portuguese: "pt", russian: "ru", korean: "ko", "chinese simplified": "zhs", "chinese traditional": "zht",
};

export function parseLanguage(v: string | undefined): string {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return "en";
  return LANG[s] ?? s;
}

export function csvToBatch(text: string): { lines: BatchLine[]; columns: Partial<Record<Field, number>>; error?: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { lines: [], columns: {}, error: "CSV needs a header row and at least one card." };
  const columns = detectColumns(rows[0]);
  if (columns.name == null && columns.scryfallId == null) {
    return { lines: [], columns, error: "Couldn't find a Name or Scryfall ID column." };
  }
  const at = (r: string[], f: Field) => (columns[f] != null ? r[columns[f]!]?.trim() : undefined);
  const lines: BatchLine[] = rows.slice(1).map((r, i) => {
    const qty = parseInt(at(r, "quantity") ?? "1", 10);
    const price = at(r, "purchasePrice");
    return {
      lineNo: i + 2,
      raw: r.join(","),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      name: at(r, "name") ?? "",
      set: at(r, "set")?.length && at(r, "set")!.length <= 6 ? at(r, "set")!.toLowerCase() : undefined,
      setName: at(r, "set") && at(r, "set")!.length > 6 ? at(r, "set") : undefined,
      collectorNumber: at(r, "collectorNumber") || undefined,
      finish: parseFinish(at(r, "finish")),
      condition: parseCondition(at(r, "condition")),
      language: parseLanguage(at(r, "language")),
      purchasePrice: price ? Number(price.replace(/[^0-9.]/g, "")) || undefined : undefined,
      scryfallId: at(r, "scryfallId") || undefined,
    };
  });
  return { lines: lines.filter((l) => l.name || l.scryfallId), columns };
}
