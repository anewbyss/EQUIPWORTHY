// Moxfield import/export. Moxfield has no public API. Deck URLs are tried via
// the endpoint its own site uses; browsers often block it (CORS/Cloudflare), in
// which case the user pastes Moxfield's "Export → Text" output instead.

import type { Board, CollectionItem } from "./types";
import { csvRow } from "./csv";

export function deckIdFromUrl(url: string): string | null {
  const m = url.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export interface MoxfieldDeck {
  name: string;
  format: string;
  cards: { name: string; quantity: number; board: Board; set?: string; collectorNumber?: string; scryfallId?: string }[];
}

interface MoxBoardCard {
  quantity: number;
  card: { name: string; set?: string; cn?: string; scryfall_id?: string };
}

export async function fetchDeck(url: string): Promise<MoxfieldDeck> {
  const id = deckIdFromUrl(url);
  if (!id) throw new Error("Not a Moxfield deck URL");
  const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${id}`);
  if (!res.ok) throw new Error(`Moxfield returned ${res.status}`);
  const j = await res.json();
  const boards: Record<string, { cards?: Record<string, MoxBoardCard> }> = j.boards ?? {};
  const map: Record<string, Board> = { commanders: "commander", mainboard: "main", sideboard: "side", maybeboard: "maybe" };
  const cards: MoxfieldDeck["cards"] = [];
  for (const [boardName, board] of Object.entries(boards)) {
    const b = map[boardName];
    if (!b) continue;
    for (const entry of Object.values(board.cards ?? {})) {
      cards.push({
        name: entry.card.name,
        quantity: entry.quantity,
        board: b,
        set: entry.card.set,
        collectorNumber: entry.card.cn,
        scryfallId: entry.card.scryfall_id,
      });
    }
  }
  return { name: j.name ?? "Moxfield deck", format: j.format ?? "commander", cards };
}

/** Moxfield collection CSV (importable at moxfield.com/collection). */
export function collectionToMoxfieldCsv(items: CollectionItem[]): string {
  const condMap = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };
  const header = ["Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags", "Collector Number", "Purchase Price"];
  const rows = items.map((i) =>
    csvRow([
      String(i.quantity),
      i.binder === "Trade Binder" ? String(i.quantity) : "0",
      i.name,
      i.set,
      condMap[i.condition],
      i.language,
      i.finish === "foil" ? "foil" : i.finish === "etched" ? "etched" : "",
      "",
      i.collectorNumber,
      i.purchasePrice != null ? i.purchasePrice.toFixed(2) : "",
    ]),
  );
  return [csvRow(header), ...rows].join("\n");
}
