// Batch entry parsing: free-form decklists, Arena/MTGO/Moxfield exports, and
// "set grid" collector-number entry. Pure functions — no network.

import type { Board, Condition, Finish } from "./types";
import { parseCondition } from "./csv";

export interface BatchLine {
  lineNo: number;
  raw: string;
  quantity: number;
  name: string;
  set?: string;
  setName?: string;
  collectorNumber?: string;
  finish: Finish;
  condition?: Condition;
  language?: string;
  purchasePrice?: number;
  scryfallId?: string;
  board?: Board;
}

const SECTION: [RegExp, Board][] = [
  [/^(commander|commanders)\b:?$/i, "commander"],
  [/^(deck|main|mainboard|main deck|companion)\b:?$/i, "main"],
  [/^(sideboard|side)\b:?$/i, "side"],
  [/^(maybeboard|maybe|considering)\b:?$/i, "maybe"],
];

/**
 * Parse one decklist / list line. Supports:
 *   4 Lightning Bolt
 *   4x Lightning Bolt
 *   1 Sol Ring (CMM) 410 *F*
 *   1 Sol Ring [CMM] #410 foil
 *   Lightning Bolt
 *   SB: 2 Duress
 */
export function parseLine(raw: string, lineNo = 0): BatchLine | null {
  let s = raw.trim();
  if (!s || s.startsWith("//") || s.startsWith("#")) return null;
  let board: Board | undefined;
  if (/^SB:\s*/i.test(s)) {
    board = "side";
    s = s.replace(/^SB:\s*/i, "");
  }

  let finish: Finish = "nonfoil";
  if (/\*E\*|\betched\b/i.test(s)) finish = "etched";
  else if (/\*F\*|\(foil\)|\bfoil\b/i.test(s)) finish = "foil";
  s = s.replace(/\*[EF]\*|\(foil\)|\b(etched|foil)\b/gi, " ");

  // Moxfield tags like #Ramp, and price suffix like "@ 3.50"
  s = s.replace(/\s#[A-Za-z][\w-]*/g, " ");
  let purchasePrice: number | undefined;
  const priceM = s.match(/\s@\s*\$?(\d+(?:\.\d+)?)\s*$/);
  if (priceM) {
    purchasePrice = Number(priceM[1]);
    s = s.slice(0, priceM.index);
  }

  // Trailing condition token like "[NM]" or "LP"
  let condition: Condition | undefined;
  const condM = s.match(/\s\[?(NM|LP|MP|HP|DMG)\]?\s*$/i);
  if (condM) {
    condition = parseCondition(condM[1]);
    s = s.slice(0, condM.index);
  }

  let quantity = 1;
  const qtyM = s.match(/^(\d+)\s*x?\s+/i);
  if (qtyM) {
    quantity = parseInt(qtyM[1], 10);
    s = s.slice(qtyM[0].length);
  }

  let set: string | undefined;
  let collectorNumber: string | undefined;
  // (SET) 123  or  [SET] #123  or  (SET)
  const setM = s.match(/\s[([]([A-Za-z0-9]{2,6})[)\]](?:\s+#?([A-Za-z0-9★\-]+))?\s*$/);
  if (setM) {
    set = setM[1].toLowerCase();
    collectorNumber = setM[2];
    s = s.slice(0, setM.index);
  }

  const name = s.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return { lineNo, raw, quantity, name, set, collectorNumber, finish, condition, purchasePrice, board };
}

export function parseList(text: string): BatchLine[] {
  const out: BatchLine[] = [];
  let board: Board = "main";
  let sawBlank = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t) {
      // Arena exports separate the sideboard with a blank line after the deck
      if (out.length) sawBlank = true;
      return;
    }
    const sec = SECTION.find(([re]) => re.test(t));
    if (sec) {
      board = sec[1];
      sawBlank = false;
      return;
    }
    const line = parseLine(raw, i + 1);
    if (!line) return;
    if (!line.board) line.board = sawBlank && board === "main" ? "side" : board;
    out.push(line);
  });
  return out;
}

/**
 * Set-grid entry: a set code plus collector numbers.
 *   "12, 45, 45f, 210, 3x88, 101e"
 * f = foil, e = etched, Nx = quantity. Ranges like "10-14" add each number.
 */
export function parseSetGrid(set: string, text: string): BatchLine[] {
  const out: BatchLine[] = [];
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  for (const tok of tokens) {
    const m = tok.match(/^(?:(\d+)x)?(\d+[a-dg-z★]?)(?:-(\d+))?([fe])?$/i);
    if (!m) {
      out.push({ lineNo: out.length + 1, raw: tok, quantity: 0, name: "", set, collectorNumber: tok, finish: "nonfoil" });
      continue;
    }
    const qty = m[1] ? parseInt(m[1], 10) : 1;
    const finish: Finish = m[4]?.toLowerCase() === "f" ? "foil" : m[4]?.toLowerCase() === "e" ? "etched" : "nonfoil";
    const start = m[2];
    const end = m[3];
    const numbers: string[] = [];
    if (end && /^\d+$/.test(start)) {
      const a = parseInt(start, 10);
      const b = parseInt(end, 10);
      for (let n = Math.min(a, b); n <= Math.max(a, b) && numbers.length < 500; n++) numbers.push(String(n));
    } else numbers.push(start);
    for (const n of numbers) {
      out.push({ lineNo: out.length + 1, raw: tok, quantity: qty, name: "", set: set.toLowerCase(), collectorNumber: n, finish });
    }
  }
  return out;
}

/** Merge lines that refer to the same printing + finish + condition. */
export function mergeDuplicates<T extends { cardId?: string; finish: Finish; condition?: Condition; quantity: number; board?: Board }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  const rest: T[] = [];
  for (const r of rows) {
    if (!r.cardId) {
      rest.push(r);
      continue;
    }
    const k = `${r.cardId}|${r.finish}|${r.condition ?? ""}|${r.board ?? ""}`;
    const prev = map.get(k);
    if (prev) prev.quantity += r.quantity;
    else map.set(k, { ...r });
  }
  return [...map.values(), ...rest];
}
