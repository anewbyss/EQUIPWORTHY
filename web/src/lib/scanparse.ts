// Turn OCR text from a card photo into lookup hints. Shared logic with
// ios/EquipWorthyKit/Sources/EquipWorthyKit/ScanParser.swift.
//
// Modern cards (2020+) print "<rarity> <collector #>/<set size>" or
// "<collector #>" on one line and "<SET> • <LANG>" on the next, bottom-left.

export interface ScanHints {
  name?: string;
  set?: string;
  collectorNumber?: string;
}

const LANGS = "EN|JP|JA|DE|FR|IT|ES|SP|PT|RU|KO|KR|CS|CT|ZHS|ZHT|PH";
const NOT_SETS = new Set(["EN", "TM", "LLC", "WOTC", "THE", "AND", "OF"]);

export function cleanName(raw: string): string | undefined {
  const line = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /[A-Za-z]{3,}/.test(l))
    .sort((a, b) => b.replace(/[^A-Za-z]/g, "").length - a.replace(/[^A-Za-z]/g, "").length)[0];
  if (!line) return undefined;
  // Keep letters, spaces and punctuation used in card names; drop mana symbols / noise.
  const cleaned = line
    .replace(/[^A-Za-zÀ-ſ ,'\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // OCR often reads trailing mana symbols as single letters: "Sol Ring O" -> "Sol Ring"
    .replace(/(\s[A-Za-z]{1,2})+$/, "")
    .trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

export function parseCollectorLine(raw: string): Pick<ScanHints, "set" | "collectorNumber"> {
  const text = raw.toUpperCase().replace(/[|]/g, "I");
  let collectorNumber: string | undefined;
  let set: string | undefined;

  const frac = text.match(/\b0*(\d{1,4})\s*\/\s*\d{1,4}\b/);
  if (frac) collectorNumber = frac[1];
  else {
    // "R 0123" / "C 45" / "0278 M"
    const lone = text.match(/(?:^|\s)[CURMSLTP]?\s?0*(\d{1,4}[A-Z]?)(?=\s|$)/m);
    if (lone) collectorNumber = lone[1];
  }

  const withLang = text.match(new RegExp(`\\b([A-Z0-9]{3,5})\\s*[•·.*\\-]?\\s*(?:${LANGS})\\b`));
  if (withLang && !NOT_SETS.has(withLang[1]) && /[A-Z]/.test(withLang[1])) set = withLang[1];
  else {
    const tokens = text.match(/\b[A-Z][A-Z0-9]{2,4}\b/g) ?? [];
    set = tokens.find((t) => !NOT_SETS.has(t) && !new RegExp(`^(${LANGS})$`).test(t));
  }
  return { set: set?.toLowerCase(), collectorNumber };
}

export function parseScan(nameText: string, bottomText: string): ScanHints {
  return { name: cleanName(nameText), ...parseCollectorLine(bottomText) };
}

/** Normalised similarity 0..1 (Dice coefficient on bigrams). */
export function similarity(a: string, b: string): number {
  const bg = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z]/g, "");
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const x = bg(a), y = bg(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  x.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
  let hit = 0;
  for (const g of y) {
    const n = counts.get(g) ?? 0;
    if (n > 0) (hit++, counts.set(g, n - 1));
  }
  return (2 * hit) / (x.length + y.length);
}
