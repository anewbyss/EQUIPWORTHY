// EDHREC data. EDHREC has no official public API; its site is backed by JSON
// pages at json.edhrec.com. These requests may be blocked (CORS / network) on
// some browsers, so every caller must treat the result as optional.

export interface EdhrecCardInfo {
  numDecks?: number;
  potentialDecks?: number;
  inclusionPct?: number;
  topCommanders: { name: string; numDecks?: number }[];
  synergies: { name: string; synergy?: number }[];
  url: string;
}

export function slug(name: string): string {
  return name
    .split(" // ")[0]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export const cardUrl = (name: string) => `https://edhrec.com/cards/${slug(name)}`;
export const commanderUrl = (name: string) => `https://edhrec.com/commanders/${slug(name)}`;

const cache = new Map<string, EdhrecCardInfo | null>();

interface CardView {
  name?: string;
  num_decks?: number;
  synergy?: number;
}

export async function cardInfo(name: string): Promise<EdhrecCardInfo | null> {
  const key = slug(name);
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(`https://json.edhrec.com/pages/cards/${key}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const card = j?.container?.json_dict?.card ?? {};
    const lists: { header?: string; tag?: string; cardviews?: CardView[] }[] = j?.container?.json_dict?.cardlists ?? [];
    const cmdrList = lists.find((l) => /commander/i.test(l.header ?? l.tag ?? ""));
    const synList = lists.find((l) => /synerg|high/i.test(l.header ?? l.tag ?? ""));
    const info: EdhrecCardInfo = {
      numDecks: card.num_decks,
      potentialDecks: card.potential_decks,
      inclusionPct: card.num_decks && card.potential_decks ? (100 * card.num_decks) / card.potential_decks : undefined,
      topCommanders: (cmdrList?.cardviews ?? []).slice(0, 8).map((c) => ({ name: c.name ?? "", numDecks: c.num_decks })),
      synergies: (synList?.cardviews ?? []).slice(0, 8).map((c) => ({ name: c.name ?? "", synergy: c.synergy })),
      url: cardUrl(name),
    };
    cache.set(key, info);
    return info;
  } catch {
    cache.set(key, null);
    return null;
  }
}
