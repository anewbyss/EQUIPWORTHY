#!/usr/bin/env python3
"""EquipWorthy daily market scan.

Reads Scryfall's "default_cards" bulk file (JSON Lines or JSON) (every English printing with its
TCGplayer USD prices), keeps a rolling 30-day price history, and writes a
small movers.json the apps download: the biggest risers and fallers across
all cards, plus buy signals (popular cards dipping below their 30-day average)
and sell signals (sharp spikes). See docs/MARKET.md.

Usage:
  build_feed.py --bulk default-cards.jsonl.gz --history history.json.gz --out movers.json [--date YYYY-MM-DD]
The history file is read if present and rewritten.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import sys

HISTORY_DAYS = 31
MIN_TRACK = 0.5  # only keep history for printings worth at least this (keeps the file small)
LIST_SIZE = 150
SIGNAL_SIZE = 100

# Thresholds, matching the apps' defaults (docs/MARKET.md).
MIN_PRICE = 1.0  # risers/fallers: current or earlier price at least this
MIN_MOVE_1D = 0.5  # and moved at least this many dollars
MIN_MOVE_7D = 1.0
BUY_MIN_PRICE = 2.0
BUY_DROP_7D = -20.0  # % over 7 days
BUY_BELOW_AVG = 0.85  # price at most 85% of the 30-day average
BUY_MAX_RANK = 15000  # EDHREC rank: only cards people actually play
SELL_MIN_PRICE = 3.0
SELL_RISE_7D = 30.0
SELL_ABOVE_AVG = 1.25


def iter_cards(path: str):
    """Stream cards from the bulk file: JSON Lines (Scryfall's current format, one card
    per line, optionally gzipped) or a JSON array (ijson if installed, else json)."""
    with open(path, "rb") as f:
        gz = f.read(2) == b"\x1f\x8b"  # by content: a download may already be decompressed
    opener = gzip.open if gz else open
    if ".jsonl" in os.path.basename(path):
        with opener(path, "rt", encoding="utf-8") as f:
            for line in f:
                line = line.strip().rstrip(",")
                if line and line not in ("[", "]"):
                    yield json.loads(line)
        return
    with opener(path, "rb") as f:
        try:
            import ijson  # type: ignore

            yield from ijson.items(f, "item", use_float=True)
        except ImportError:
            yield from json.load(f)


def num(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def image_of(c: dict):
    uris = c.get("image_uris") or ((c.get("card_faces") or [{}])[0].get("image_uris") or {})
    return uris.get("small")


def load_history(path: str) -> dict:
    if not os.path.exists(path):
        return {"dates": [], "p": {}}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        h = json.load(f)
    return {"dates": h.get("dates", []), "p": h.get("p", {})}


def save_history(path: str, h: dict) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(h, f, separators=(",", ":"))


def pct(now: float | None, then: float | None):
    if now is None or then is None or then <= 0:
        return None
    return round((now - then) / then * 100, 1)


def back(series: list, days: int):
    """Price `days` entries before the latest one (entries are daily), else None."""
    i = len(series) - 1 - days
    return series[i] if i >= 0 else None


def scan(cards, history: dict, date: str):
    """Fold today's prices into the history and return (entries, scanned, info)."""
    dates = history["dates"]
    old = history["p"]
    if dates and dates[-1] == date:  # re-run on the same day: replace today's point
        dates = dates[:-1]
        old = {k: v[:-1] for k, v in old.items()}
    dates = (dates + [date])[-HISTORY_DAYS:]
    n = len(dates)
    new: dict[str, list] = {}
    info: dict[str, dict] = {}
    scanned = 0

    for c in cards:
        if c.get("lang") != "en" or c.get("digital") or "paper" not in (c.get("games") or ["paper"]):
            continue
        prices = c.get("prices") or {}
        cid = c.get("id")
        if not cid:
            continue
        scanned += 1
        for finish, key in (("nonfoil", "usd"), ("foil", "usd_foil")):
            p = num(prices.get(key))
            k = f"{cid}:{'n' if finish == 'nonfoil' else 'f'}"
            prev = old.get(k)
            if p is None and prev is None:
                continue
            if (p or 0) < MIN_TRACK and not (prev and any((x or 0) >= MIN_TRACK for x in prev)):
                continue
            series = ((prev or []) + [p])[-n:]
            series = [None] * (n - len(series)) + series
            new[k] = series
            if cid not in info:
                info[cid] = {
                    "name": c.get("name", ""),
                    "oracleId": c.get("oracle_id"),
                    "set": c.get("set", ""),
                    "setName": c.get("set_name", ""),
                    "number": c.get("collector_number", ""),
                    "rarity": c.get("rarity", ""),
                    "image": image_of(c),
                    "tcgplayer": (c.get("purchase_uris") or {}).get("tcgplayer"),
                    "edhrecRank": c.get("edhrec_rank"),
                }

    history["dates"] = dates
    history["p"] = new

    entries = []
    for k, series in new.items():
        price = series[-1]
        if price is None:
            continue
        cid, f = k.split(":")
        p1, p7, p30 = back(series, 1), back(series, 7), back(series, 30) or next((x for x in series if x is not None), None)
        known = [x for x in series if x is not None]
        avg = round(sum(known) / len(known), 2) if known else None
        entries.append({
            "id": cid,
            "finish": "nonfoil" if f == "n" else "foil",
            "price": price,
            "d1": pct(price, p1), "d7": pct(price, p7), "d30": pct(price, p30) if len(known) > 7 else None,
            "move1": round(price - p1, 2) if p1 else None, "move7": round(price - p7, 2) if p7 else None,
            "avg30": avg,
        })
    return entries, scanned, info


def pick(entries, info):
    """Choose the lists and signals; returns entries tagged with the lists they're in."""
    def ok(e, move_key, min_move):
        before = e["price"] - (e[move_key] or 0)
        return max(e["price"], before) >= MIN_PRICE and abs(e[move_key] or 0) >= min_move

    lists = {
        "up1": sorted((e for e in entries if (e["d1"] or 0) > 0 and ok(e, "move1", MIN_MOVE_1D)), key=lambda e: -e["d1"])[:LIST_SIZE],
        "down1": sorted((e for e in entries if (e["d1"] or 0) < 0 and ok(e, "move1", MIN_MOVE_1D)), key=lambda e: e["d1"])[:LIST_SIZE],
        "up7": sorted((e for e in entries if (e["d7"] or 0) > 0 and ok(e, "move7", MIN_MOVE_7D)), key=lambda e: -e["d7"])[:LIST_SIZE],
        "down7": sorted((e for e in entries if (e["d7"] or 0) < 0 and ok(e, "move7", MIN_MOVE_7D)), key=lambda e: e["d7"])[:LIST_SIZE],
    }

    def rank(e):
        r = info.get(e["id"], {}).get("edhrecRank")
        return r if isinstance(r, int) else 10**9

    buys = [
        e for e in entries
        if e["price"] >= BUY_MIN_PRICE and (e["d7"] or 0) <= BUY_DROP_7D and e["avg30"] and e["price"] <= e["avg30"] * BUY_BELOW_AVG and rank(e) <= BUY_MAX_RANK
    ]
    sells = [
        e for e in entries
        if e["price"] >= SELL_MIN_PRICE and (e["d7"] or 0) >= SELL_RISE_7D and e["avg30"] and e["price"] >= e["avg30"] * SELL_ABOVE_AVG
    ]
    lists["buy"] = sorted(buys, key=lambda e: (rank(e), e["d7"]))[:SIGNAL_SIZE]
    lists["sell"] = sorted(sells, key=lambda e: -e["d7"])[:SIGNAL_SIZE]

    out: dict[str, dict] = {}
    for name, items in lists.items():
        for e in items:
            key = f"{e['id']}:{e['finish']}"
            row = out.setdefault(key, {**info.get(e["id"], {}), **{k: v for k, v in e.items() if v is not None}, "lists": []})
            row["lists"].append(name)
            if name in ("buy", "sell"):
                row["signal"] = name
    return list(out.values())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", required=True)
    ap.add_argument("--history", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--date", default=dt.datetime.now(dt.timezone.utc).date().isoformat())
    a = ap.parse_args(argv)

    history = load_history(a.history)
    entries, scanned, info = scan(iter_cards(a.bulk), history, a.date)
    rows = pick(entries, info)
    feed = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "date": a.date,
        "scanned": scanned,
        "historyDays": len(history["dates"]),
        "entries": rows,
    }
    save_history(a.history, history)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(feed, f, separators=(",", ":"))
    print(f"{a.date}: scanned {scanned} printings, {len(history['p'])} price series, {len(rows)} movers/signals, history {len(history['dates'])} days")
    return feed


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
