import { describe, expect, it } from "vitest";
import { addRoll, changeCounter, changeLife, commanderDamage, eliminated, flipCoin, newGame, nextTurn, rematch, roll } from "../game";

describe("life tracker", () => {
  it("starts players at the chosen life", () => {
    const g = newGame(4, 40, ["Ann"]);
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
    expect(g.players[0].name).toBe("Ann");
    expect(g.players[1].name).toBe("Player 2");
  });

  it("merges rapid taps into one log line", () => {
    const t0 = new Date("2026-10-27T00:00:00Z");
    let g = newGame(2, 20);
    const id = g.players[0].id;
    g = changeLife(g, id, -1, t0);
    g = changeLife(g, id, -1, new Date(t0.getTime() + 500));
    g = changeLife(g, id, -1, new Date(t0.getTime() + 1000));
    expect(g.players[0].life).toBe(17);
    expect(g.log).toHaveLength(1);
    expect(g.log[0].text).toBe("Player 1 −3 (20 → 17)");
    g = changeLife(g, id, 2, new Date(t0.getTime() + 10_000));
    expect(g.log).toHaveLength(2);
  });

  it("commander damage reduces life and is lethal at 21", () => {
    let g = newGame(2, 40);
    const [a, b] = g.players;
    g = commanderDamage(g, a.id, b.id, 21);
    expect(g.players[0].life).toBe(19);
    expect(g.players[0].commanderDamage[b.id]).toBe(21);
    expect(eliminated(g.players[0])).toBe("commander damage");
    g = commanderDamage(g, a.id, b.id, -30);
    expect(g.players[0].commanderDamage[b.id]).toBe(0);
    expect(g.players[0].life).toBe(40);
  });

  it("poison is lethal at 10 and never negative", () => {
    let g = newGame(2, 20);
    const id = g.players[1].id;
    g = changeCounter(g, id, "poison", -1);
    expect(g.players[1].poison).toBe(0);
    g = changeCounter(g, id, "poison", 10);
    expect(eliminated(g.players[1])).toBe("poison");
  });

  it("turns skip eliminated players and count rounds", () => {
    let g = newGame(3, 20);
    g = changeLife(g, g.players[1].id, -20);
    g = nextTurn(g);
    expect(g.activePlayer).toBe(2);
    g = nextTurn(g);
    expect(g.activePlayer).toBe(0);
    expect(g.turn).toBe(2);
  });

  it("rematch keeps names", () => {
    const g = rematch(changeLife(newGame(2, 20, ["A", "B"]), newGame(1, 1).players[0].id, 1));
    expect(g.players.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("dice", () => {
  const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
  it("rolls with modifier", () => {
    const r = roll(2, 6, 1, seq(0, 0.999));
    expect(r.results).toEqual([1, 6]);
    expect(r.total).toBe(8);
    expect(r.label).toBe("2d6+1");
  });
  it("d20 range is 1..20", () => {
    for (let i = 0; i < 200; i++) { const v = roll(1, 20).total; expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(20); }
  });
  it("coin flip and history cap", () => {
    expect(flipCoin(() => 0.1).text).toBe("Heads");
    let g = newGame(2, 20);
    for (let i = 0; i < 120; i++) g = addRoll(g, roll(1, 6));
    expect(g.rolls).toHaveLength(100);
  });
});
