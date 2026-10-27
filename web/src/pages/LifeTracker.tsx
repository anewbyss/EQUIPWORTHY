import { useState } from "react";
import { PageHeader } from "../components/ui";
import {
  COMMANDER_LETHAL,
  addRoll,
  changeCounter,
  changeLife,
  commanderDamage,
  eliminated,
  flipCoin,
  newGame,
  nextTurn,
  randomPlayer,
  rematch,
  roll,
  type Counter,
} from "../lib/game";
import { update, useProfile } from "../lib/store";
import type { GamePlayer, GameState } from "../lib/types";

const DICE = [4, 6, 8, 10, 12, 20, 100];
const COUNTERS: [Counter, string, string][] = [
  ["poison", "Poison", "☠"],
  ["energy", "Energy", "⚡"],
  ["experience", "Exp", "✦"],
  ["commanderTax", "Cmdr tax", "⟳"],
];

export default function LifeTrackerPage() {
  const p = useProfile();
  const game = p.game;
  const setGame = (fn: (g: GameState) => GameState) => update((cur) => (cur.game ? { ...cur, game: fn(cur.game) } : cur));

  if (!game) return <Setup onStart={(g) => update((cur) => ({ ...cur, game: g }))} />;

  return (
    <>
      <PageHeader title="Life & Dice" sub={`Turn ${game.turn} · ${game.players[game.activePlayer]?.name}'s turn`}>
        <button className="btn primary" onClick={() => setGame((g) => nextTurn(g))}>Next turn ▸</button>
        <button className="btn" onClick={() => confirm("Start a rematch with the same players?") && update((cur) => ({ ...cur, game: rematch(game) }))}>Rematch</button>
        <button className="btn danger" onClick={() => confirm("End this game and set up a new one?") && update((cur) => ({ ...cur, game: undefined }))}>New game</button>
      </PageHeader>

      <div className={`players players-${Math.min(game.players.length, 4)}`}>
        {game.players.map((pl, i) => (
          <PlayerPanel key={pl.id} player={pl} game={game} active={i === game.activePlayer} setGame={setGame} />
        ))}
      </div>

      <div className="grid2">
        <DicePanel game={game} setGame={setGame} />
        <div className="card">
          <h2>Game log</h2>
          {game.log.length ? (
            <ul className="log">
              {game.log.slice(0, 60).map((l, i) => (
                <li key={i}><span className="muted small">{new Date(l.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> {l.text}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Life changes, damage, counters and turns show up here.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Setup({ onStart }: { onStart: (g: GameState) => void }) {
  const [players, setPlayers] = useState(4);
  const [life, setLife] = useState(40);
  const [names, setNames] = useState<string[]>([]);
  return (
    <>
      <PageHeader title="Life & Dice" sub="Track life, commander damage, poison and counters, and roll dice. Games are saved as you play." />
      <div className="card stack">
        <h2>New game</h2>
        <div className="row gap">
          <span>Players</span>
          <div className="seg">{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className={players === n ? "on" : ""} onClick={() => setPlayers(n)}>{n}</button>)}</div>
        </div>
        <div className="row gap">
          <span>Starting life</span>
          <div className="seg">
            {[[20, "20 Standard"], [25, "25 Brawl"], [30, "30 Two-Headed"], [40, "40 Commander"]].map(([v, l]) => (
              <button key={v} className={life === v ? "on" : ""} onClick={() => setLife(v as number)}>{l}</button>
            ))}
          </div>
          <input type="number" min={1} value={life} onChange={(e) => setLife(Math.max(1, Number(e.target.value)))} aria-label="Custom starting life" />
        </div>
        <div className="row gap">
          {Array.from({ length: players }, (_, i) => (
            <input key={i} placeholder={`Player ${i + 1}`} value={names[i] ?? ""} onChange={(e) => { const n = [...names]; n[i] = e.target.value; setNames(n); }} style={{ width: "9rem" }} aria-label={`Player ${i + 1} name`} />
          ))}
        </div>
        <button className="btn primary" onClick={() => onStart(newGame(players, life, names))}>Start game</button>
      </div>
    </>
  );
}

function PlayerPanel({ player, game, active, setGame }: { player: GamePlayer; game: GameState; active: boolean; setGame: (fn: (g: GameState) => GameState) => void }) {
  const dead = eliminated(player);
  const [showCmd, setShowCmd] = useState(game.startingLife >= 40);
  const opponents = game.players.filter((o) => o.id !== player.id);
  const life = (d: number) => setGame((g) => changeLife(g, player.id, d));
  return (
    <div className={`player pc-${player.color} ${active ? "active" : ""} ${dead ? "dead" : ""}`}>
      <div className="row between">
        <input className="player-name" value={player.name} onChange={(e) => setGame((g) => ({ ...g, players: g.players.map((x) => (x.id === player.id ? { ...x, name: e.target.value } : x)) }))} aria-label="Player name" />
        {active && <span className="pill gold-pill">Active</span>}
      </div>
      <div className="life-row">
        <button className="life-btn" onClick={() => life(-5)} aria-label={`${player.name} minus 5`}>−5</button>
        <button className="life-btn" onClick={() => life(-1)} aria-label={`${player.name} minus 1`}>−</button>
        <div className="life" aria-live="polite">{player.life}</div>
        <button className="life-btn" onClick={() => life(1)} aria-label={`${player.name} plus 1`}>+</button>
        <button className="life-btn" onClick={() => life(5)} aria-label={`${player.name} plus 5`}>+5</button>
      </div>
      {dead && <div className="dead-banner">Eliminated by {dead}</div>}
      <div className="counters">
        {COUNTERS.map(([key, label, icon]) => (
          <div key={key} className={`counter ${player[key] ? "on" : ""}`}>
            <span title={label}>{icon} {label}</span>
            <div className="row">
              <button onClick={() => setGame((g) => changeCounter(g, player.id, key, -1))} aria-label={`${label} minus`}>−</button>
              <b>{player[key]}</b>
              <button onClick={() => setGame((g) => changeCounter(g, player.id, key, 1))} aria-label={`${label} plus`}>+</button>
            </div>
          </div>
        ))}
      </div>
      {opponents.length > 0 && (
        <>
          <button className="linkish small" onClick={() => setShowCmd(!showCmd)}>{showCmd ? "▾" : "▸"} Commander damage taken</button>
          {showCmd && (
            <div className="cmd-grid">
              {opponents.map((o) => {
                const d = player.commanderDamage[o.id] ?? 0;
                return (
                  <div key={o.id} className={`counter cmd pc-${o.color} ${d >= COMMANDER_LETHAL ? "lethal" : d ? "on" : ""}`}>
                    <span>from {o.name}</span>
                    <div className="row">
                      <button onClick={() => setGame((g) => commanderDamage(g, player.id, o.id, -1))} aria-label={`Commander damage from ${o.name} minus`}>−</button>
                      <b>{d}</b>
                      <button onClick={() => setGame((g) => commanderDamage(g, player.id, o.id, 1))} aria-label={`Commander damage from ${o.name} plus`}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DicePanel({ game, setGame }: { game: GameState; setGame: (fn: (g: GameState) => GameState) => void }) {
  const [count, setCount] = useState(1);
  const [mod, setMod] = useState(0);
  const [spin, setSpin] = useState(0);
  const last = game.rolls[0];
  const go = (r: ReturnType<typeof roll>) => {
    setSpin((s) => s + 1);
    setGame((g) => addRoll(g, r));
  };
  return (
    <div className="card stack">
      <h2>Dice</h2>
      <div className="dice-buttons">
        {DICE.map((d) => <button key={d} className="die" onClick={() => go(roll(count, d, mod))}>d{d}</button>)}
      </div>
      <div className="row gap small">
        <label>Dice <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} /></label>
        <label>Modifier <input type="number" value={mod} onChange={(e) => setMod(Number(e.target.value) || 0)} /></label>
        <button className="btn small" onClick={() => go(flipCoin())}>Flip coin</button>
        <button className="btn small" onClick={() => go(randomPlayer(game))}>Random player</button>
      </div>
      {last && (
        <div key={spin} className="roll-result">
          <div className="roll-total">{last.text ?? last.total}</div>
          <div className="muted small">
            {last.label}
            {last.label.includes("d") && last.results.length > 1 && <> · [{last.results.join(", ")}]</>}
          </div>
        </div>
      )}
      {game.rolls.length > 1 && (
        <div className="muted small">
          Earlier: {game.rolls.slice(1, 11).map((r, i) => <span key={i} className="pill" style={{ marginRight: 4 }}>{r.label} → {r.text ?? r.total}</span>)}
        </div>
      )}
    </div>
  );
}
