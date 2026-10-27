// Shared data model. The JSON backup format is identical on web and iOS, so a
// profile exported from one platform can be imported into the other.
// See docs/DATA_MODEL.md.

export const SCHEMA_VERSION = 1;

export type Finish = "nonfoil" | "foil" | "etched";
export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";
export const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];
export const FINISHES: Finish[] = ["nonfoil", "foil", "etched"];

/** Minimal card data cached locally so the app works offline. */
export interface CardSummary {
  id: string; // Scryfall id
  oracleId?: string;
  name: string;
  set: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  typeLine: string;
  manaCost?: string;
  cmc: number;
  colors: string[];
  colorIdentity: string[];
  image?: string; // normal-size image url
  imageSmall?: string;
  releasedAt: string; // YYYY-MM-DD
  reserved: boolean;
  reprint: boolean;
  edhrecRank?: number;
  legalities: Record<string, string>;
  prices: { usd?: number; usdFoil?: number; usdEtched?: number };
  finishes: Finish[];
  tcgplayerUrl?: string;
  edhrecUrl?: string;
  scryfallUrl?: string;
  oracleText?: string;
  printsCount?: number; // number of printings with this oracle id, when known
  fetchedAt: string; // ISO timestamp
}

export interface CollectionItem {
  id: string;
  cardId: string;
  name: string;
  set: string;
  collectorNumber: string;
  finish: Finish;
  condition: Condition;
  language: string;
  quantity: number;
  purchasePrice?: number;
  purchaseDate?: string;
  binder: string; // "Main", "Trade Binder", custom
  location?: string; // physical location: box, shelf...
  addedAt: string;
}

export interface WishItem {
  id: string;
  cardId: string;
  name: string;
  finish: Finish;
  quantity: number;
  maxPrice?: number;
  addedAt: string;
}

export type Board = "commander" | "main" | "side" | "maybe";

export interface DeckCard {
  cardId: string;
  name: string;
  quantity: number;
  board: Board;
}

export type Format =
  | "commander"
  | "standard"
  | "pioneer"
  | "modern"
  | "legacy"
  | "vintage"
  | "pauper"
  | "limited";
export const FORMATS: Format[] = ["commander", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "limited"];

export interface Deck {
  id: string;
  name: string;
  format: Format;
  cards: DeckCard[];
  notes?: string;
  source?: string; // e.g. Moxfield url
  createdAt: string;
  updatedAt: string;
}

export interface WatchItem {
  id: string;
  cardId: string;
  name: string;
  finish: Finish;
  below?: number; // alert when price <= below
  above?: number; // alert when price >= above
  pctMove?: number; // alert when 7-day move exceeds +/- pct
  addedAt: string;
}

export interface Alert {
  id: string;
  cardId: string;
  name: string;
  kind: "below" | "above" | "move";
  message: string;
  createdAt: string;
  read: boolean;
}

export interface TradeSideCard {
  cardId: string;
  name: string;
  finish: Finish;
  quantity: number;
  price: number; // price at time of adding; refreshed on reprice
}

export interface Trade {
  id: string;
  name: string;
  mine: TradeSideCard[];
  theirs: TradeSideCard[];
  mineCash: number;
  theirsCash: number;
  createdAt: string;
  updatedAt: string;
}

/** A forecast recorded so we can later measure accuracy. */
export interface ForecastLogEntry {
  cardId: string;
  finish: Finish;
  madeOn: string; // YYYY-MM-DD
  horizonDays: number;
  startPrice: number;
  expectedPct: number;
  resolvedPct?: number; // actual move once the horizon has passed
}

/** date (YYYY-MM-DD) -> price */
export type PriceSeries = [string, number][];

export interface Settings {
  autosaveSeconds: number;
  buylistCashPct: number;
  buylistCreditPct: number;
  defaultCondition: Condition;
  defaultBinder: string;
  conditionMultipliers: Record<Condition, number>;
  autoRefreshHours: number;
  notifications: boolean;
}

export interface Profile {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  binders: string[];
  collection: CollectionItem[];
  wishlist: WishItem[];
  decks: Deck[];
  watchlist: WatchItem[];
  alerts: Alert[];
  trades: Trade[];
  /** key: `${cardId}:${finish}` */
  priceHistory: Record<string, PriceSeries>;
  portfolioHistory: PriceSeries;
  forecastLog: ForecastLogEntry[];
  cardCache: Record<string, CardSummary>;
  lastPriceRefresh?: string;
  /** Batch-entry review queue, persisted so nothing is lost on reload. */
  pendingBatch?: PendingRow[];
}

export interface PendingRow {
  key: string;
  raw: string;
  status: "ok" | "fuzzy" | "notfound";
  cardId?: string;
  name: string;
  set?: string;
  collectorNumber?: string;
  finish: Finish;
  condition: Condition;
  language: string;
  quantity: number;
  purchasePrice?: number;
  board?: Board;
  source: "list" | "grid" | "csv" | "scan";
}

export const defaultSettings = (): Settings => ({
  autosaveSeconds: 20,
  buylistCashPct: 50,
  buylistCreditPct: 65,
  defaultCondition: "NM",
  defaultBinder: "Main",
  conditionMultipliers: { NM: 1, LP: 0.9, MP: 0.75, HP: 0.55, DMG: 0.35 },
  autoRefreshHours: 12,
  notifications: true,
});

export const newProfile = (name: string): Profile => {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    binders: ["Main", "Trade Binder"],
    collection: [],
    wishlist: [],
    decks: [],
    watchlist: [],
    alerts: [],
    trades: [],
    priceHistory: {},
    portfolioHistory: [],
    forecastLog: [],
    cardCache: {},
  };
};

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const today = (d = new Date()): string => d.toISOString().slice(0, 10);

export const historyKey = (cardId: string, finish: Finish) => `${cardId}:${finish}`;

export function priceFor(card: CardSummary | undefined, finish: Finish): number | undefined {
  if (!card) return undefined;
  if (finish === "foil") return card.prices.usdFoil ?? card.prices.usd;
  if (finish === "etched") return card.prices.usdEtched ?? card.prices.usdFoil ?? card.prices.usd;
  return card.prices.usd ?? card.prices.usdFoil;
}
