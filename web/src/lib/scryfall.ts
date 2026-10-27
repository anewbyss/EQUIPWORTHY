// Scryfall API client. Scryfall asks for <= 10 requests/second, so every call
// goes through a small queue that spaces requests 100ms apart.
// Docs: https://scryfall.com/docs/api

import type { CardSummary, Finish } from "./types";

const API = "https://api.scryfall.com";
const MIN_GAP_MS = 110;

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run;
}

export class ScryfallError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  return throttled(async () => {
    const res = await fetch(path.startsWith("http") ? path : API + path, {
      headers: { Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ScryfallError(body?.details ?? `Scryfall ${res.status}`, res.status);
    return body as T;
  });
}

async function post<T>(path: string, data: unknown): Promise<T> {
  return throttled(async () => {
    const res = await fetch(API + path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ScryfallError(body?.details ?? `Scryfall ${res.status}`, res.status);
    return body as T;
  });
}

// --- raw types (only the fields we use) ---
export interface RawCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  image_uris?: { normal?: string; small?: string };
  card_faces?: { image_uris?: { normal?: string; small?: string }; type_line?: string; mana_cost?: string; oracle_text?: string; colors?: string[] }[];
  released_at: string;
  reserved: boolean;
  reprint: boolean;
  edhrec_rank?: number;
  legalities: Record<string, string>;
  prices: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
  finishes?: string[];
  purchase_uris?: { tcgplayer?: string };
  related_uris?: { edhrec?: string };
  scryfall_uri?: string;
  oracle_text?: string;
  prints_search_uri?: string;
  keywords?: string[];
}

interface List<T> {
  data: T[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
  not_found?: unknown[];
}

const num = (v?: string | null) => (v == null || v === "" ? undefined : Number(v));

export function toSummary(c: RawCard): CardSummary {
  const face = c.card_faces?.[0];
  return {
    id: c.id,
    oracleId: c.oracle_id,
    name: c.name,
    set: c.set,
    setName: c.set_name,
    collectorNumber: c.collector_number,
    rarity: c.rarity,
    typeLine: c.type_line ?? face?.type_line ?? "",
    manaCost: c.mana_cost ?? face?.mana_cost,
    cmc: c.cmc ?? 0,
    colors: c.colors ?? face?.colors ?? [],
    colorIdentity: c.color_identity ?? [],
    image: c.image_uris?.normal ?? face?.image_uris?.normal,
    imageSmall: c.image_uris?.small ?? face?.image_uris?.small,
    releasedAt: c.released_at,
    reserved: c.reserved,
    reprint: c.reprint,
    edhrecRank: c.edhrec_rank,
    legalities: c.legalities ?? {},
    prices: { usd: num(c.prices?.usd), usdFoil: num(c.prices?.usd_foil), usdEtched: num(c.prices?.usd_etched) },
    finishes: (c.finishes ?? ["nonfoil"]).filter((f): f is Finish => f === "nonfoil" || f === "foil" || f === "etched"),
    tcgplayerUrl: c.purchase_uris?.tcgplayer,
    edhrecUrl: c.related_uris?.edhrec,
    scryfallUrl: c.scryfall_uri,
    oracleText: c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).filter(Boolean).join("\n//\n"),
    keywords: c.keywords,
    fetchedAt: new Date().toISOString(),
  };
}

export async function search(query: string, opts: { unique?: "cards" | "prints"; order?: string; page?: number } = {}) {
  const p = new URLSearchParams({ q: query, unique: opts.unique ?? "cards", order: opts.order ?? "name" });
  if (opts.page) p.set("page", String(opts.page));
  try {
    const res = await get<List<RawCard>>(`/cards/search?${p}`);
    return { cards: res.data.map(toSummary), total: res.total_cards ?? res.data.length, hasMore: res.has_more };
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return { cards: [], total: 0, hasMore: false };
    throw e;
  }
}

export async function autocomplete(q: string): Promise<string[]> {
  if (q.trim().length < 2) return [];
  const res = await get<{ data: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(q)}`);
  return res.data;
}

export async function named(name: string, fuzzy = true, set?: string): Promise<CardSummary> {
  const p = new URLSearchParams({ [fuzzy ? "fuzzy" : "exact"]: name });
  if (set) p.set("set", set);
  return toSummary(await get<RawCard>(`/cards/named?${p}`));
}

export async function bySetNumber(set: string, number: string): Promise<CardSummary> {
  return toSummary(await get<RawCard>(`/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(number)}`));
}

export async function byId(id: string): Promise<CardSummary> {
  return toSummary(await get<RawCard>(`/cards/${id}`));
}

export async function prints(card: CardSummary): Promise<CardSummary[]> {
  if (!card.oracleId) return [card];
  const res = await search(`oracleid:${card.oracleId}`, { unique: "prints", order: "released" });
  return res.cards;
}

export type Identifier =
  | { id: string }
  | { set: string; collector_number: string }
  | { name: string; set?: string };

/** Resolve up to any number of identifiers, 75 per request (Scryfall's limit). */
export async function collection(ids: Identifier[]): Promise<{ found: CardSummary[]; notFound: Identifier[] }> {
  const found: CardSummary[] = [];
  const notFound: Identifier[] = [];
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    const res = await post<List<RawCard>>("/cards/collection", { identifiers: chunk });
    found.push(...res.data.map(toSummary));
    notFound.push(...((res.not_found ?? []) as Identifier[]));
  }
  return { found, notFound };
}

export interface SetInfo {
  code: string;
  name: string;
  released_at?: string;
  set_type: string;
  card_count: number;
  icon_svg_uri?: string;
}

export async function sets(): Promise<SetInfo[]> {
  const res = await get<{ data: SetInfo[] }>("/sets");
  return res.data;
}

export async function setCards(code: string, page = 1) {
  return search(`e:${code}`, { unique: "prints", order: "set", page });
}

export async function random(): Promise<CardSummary> {
  return toSummary(await get<RawCard>("/cards/random"));
}
