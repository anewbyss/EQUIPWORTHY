// Life, damage and counter tracking plus dice rolling. Pure functions so the
// iOS port (ios/EquipWorthyKit/Sources/EquipWorthyKit/Game.swift) matches.

import { uid, type DiceRoll, type GamePlayer, type GameState } from "./types";

export const PLAYER_COLORS = ["sky", "violet", "gold", "teal", "rose", "slate"] as const;
export const COMMANDER_LETHAL = 21;
export const POISON_LETHAL = 10;

export function newGame(players: number, startingLife: number, names: string[] = []): GameState {
  const n = Math.max(1, Math.min(8, players));
  return {
    startingLife,
    players: Array.from({ length: n }, (_, i): GamePlayer => ({
      id: uid(),
      name: names[i] || `Player ${i + 1}`,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      life: startingLife,
      poison: 0,
      energy: 0,
      experience: 0,
      commanderTax: 0,
      commanderDamage: {},
    })),
    turn: 1,
    activePlayer: 0,
    log: [],
    rolls: [],
    startedAt: new Date().toISOString(),
  };
}

/** Restart with the same players and names. */
export const rematch = (g: GameState): GameState => {
  const next = newGame(g.players.length, g.startingLife, g.players.map((p) => p.name));
  next.players.forEach((p, i) => (p.color = g.players[i].color));
  return next;
};

const log = (g: GameState, text: string, now: Date): GameState => ({ ...g, log: [{ at: now.toISOString(), text }, ...g.log].slice(0, 300) });

const withPlayer = (g: GameState, id: string, fn: (p: GamePlayer) => GamePlayer): GameState => ({
  ...g,
  players: g.players.map((p) => (p.id === id ? fn(p) : p)),
});

/**
 * Change life. Rapid taps on the same player within 4 seconds are merged into
 * one log line ("Alice −3 (40 → 37)") instead of three.
 */
export function changeLife(g: GameState, id: string, delta: number, now = new Date()): GameState {
  const p = g.players.find((x) => x.id === id);
  if (!p || !delta) return g;
  const next = withPlayer(g, id, (x) => ({ ...x, life: x.life + delta }));
  const newLife = p.life + delta;
  const prev = g.log[0];
  const m = prev?.text.match(/^(.*) ([+−]\d+) \((-?\d+) → (-?\d+)\)$/);
  if (prev && m && m[1] === p.name && now.getTime() - Date.parse(prev.at) < 4000 && Number(m[4]) === p.life) {
    const start = Number(m[3]);
    const total = newLife - start;
    if (total === 0) return { ...next, log: g.log.slice(1) };
    return { ...next, log: [{ at: now.toISOString(), text: `${p.name} ${fmt(total)} (${start} → ${newLife})` }, ...g.log.slice(1)] };
  }
  return log(next, `${p.name} ${fmt(delta)} (${p.life} → ${newLife})`, now);
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Commander damage also costs the same amount of life. */
export function commanderDamage(g: GameState, targetId: string, fromId: string, delta: number, now = new Date()): GameState {
  const t = g.players.find((x) => x.id === targetId);
  const from = g.players.find((x) => x.id === fromId);
  if (!t || !from || !delta) return g;
  const cur = t.commanderDamage[fromId] ?? 0;
  const nextDmg = Math.max(0, cur + delta);
  const applied = nextDmg - cur;
  if (!applied) return g;
  let next = withPlayer(g, targetId, (x) => ({ ...x, life: x.life - applied, commanderDamage: { ...x.commanderDamage, [fromId]: nextDmg } }));
  next = log(next, `${from.name}'s commander → ${t.name}: ${fmt(applied)} (${nextDmg} total)`, now);
  return next;
}

export type Counter = "poison" | "energy" | "experience" | "commanderTax";

export function changeCounter(g: GameState, id: string, counter: Counter, delta: number, now = new Date()): GameState {
  const p = g.players.find((x) => x.id === id);
  if (!p) return g;
  const value = Math.max(0, p[counter] + delta);
  if (value === p[counter]) return g;
  const label = { poison: "poison", energy: "energy", experience: "experience", commanderTax: "commander tax" }[counter];
  return log(withPlayer(g, id, (x) => ({ ...x, [counter]: value })), `${p.name} ${label} ${fmt(value - p[counter])} (${value})`, now);
}

export function nextTurn(g: GameState, now = new Date()): GameState {
  const alive = g.players.map((p, i) => ({ p, i })).filter(({ p }) => !eliminated(p));
  if (!alive.length) return g;
  let idx = (g.activePlayer + 1) % g.players.length;
  for (let k = 0; k < g.players.length && eliminated(g.players[idx]); k++) idx = (idx + 1) % g.players.length;
  const turn = idx <= g.activePlayer ? g.turn + 1 : g.turn;
  return log({ ...g, activePlayer: idx, turn }, `Turn ${turn}: ${g.players[idx].name}`, now);
}

export function eliminated(p: GamePlayer): string | null {
  if (p.life <= 0) return "life";
  if (p.poison >= POISON_LETHAL) return "poison";
  if (Object.values(p.commanderDamage).some((d) => d >= COMMANDER_LETHAL)) return "commander damage";
  return null;
}

// ---- Dice ----

export type Rng = () => number;

export const rollDie = (sides: number, rng: Rng = Math.random) => 1 + Math.floor(rng() * sides);

export function roll(count: number, sides: number, modifier = 0, rng: Rng = Math.random, now = new Date()): DiceRoll {
  const n = Math.max(1, Math.min(100, count));
  const results = Array.from({ length: n }, () => rollDie(sides, rng));
  const total = results.reduce((a, b) => a + b, 0) + modifier;
  const mod = modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : "";
  return { at: now.toISOString(), label: `${n}d${sides}${mod}`, results, total };
}

export function flipCoin(rng: Rng = Math.random, now = new Date()): DiceRoll {
  const r = rng() < 0.5 ? 1 : 0;
  return { at: now.toISOString(), label: "Coin", results: [r], total: r, text: r ? "Heads" : "Tails" };
}

export function randomPlayer(g: GameState, rng: Rng = Math.random, now = new Date()): DiceRoll {
  const i = Math.floor(rng() * g.players.length);
  return { at: now.toISOString(), label: "Random player", results: [i + 1], total: i + 1, text: g.players[i]?.name };
}

export const addRoll = (g: GameState, r: DiceRoll): GameState => ({ ...g, rolls: [r, ...g.rolls].slice(0, 100) });
