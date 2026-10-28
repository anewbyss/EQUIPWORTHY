"""Tests for the daily market scan: python3 -m unittest discover scripts/market"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import build_feed  # noqa: E402


def card(cid, name, usd=None, foil=None, rank=100, **extra):
    return {"id": cid, "oracle_id": "o-" + cid, "name": name, "lang": "en", "games": ["paper"], "set": "abc", "set_name": "Alpha Beta",
            "collector_number": "1", "rarity": "rare", "edhrec_rank": rank, "image_uris": {"small": "https://img/" + cid},
            "purchase_uris": {"tcgplayer": "https://tcg/" + cid},
            "prices": {"usd": None if usd is None else str(usd), "usd_foil": None if foil is None else str(foil)}, **extra}


class FeedTest(unittest.TestCase):
    def run_days(self, days):
        d = tempfile.mkdtemp()
        hist, out, bulk = os.path.join(d, "h.json.gz"), os.path.join(d, "m.json"), os.path.join(d, "b.json")
        feed = None
        for i, cards in enumerate(days):
            with open(bulk, "w") as f:
                json.dump(cards, f)
            feed = build_feed.main(["--bulk", bulk, "--history", hist, "--out", out, "--date", f"2026-10-{i + 1:02d}"])
        return feed, build_feed.load_history(hist)

    def test_movers_and_signals(self):
        days = []
        for i in range(9):
            spike = 10 if i < 8 else 20  # doubles on the last day
            dip = 40 if i < 8 else 25  # popular card dropping below its average
            days.append([
                card("spike", "Spiky", usd=spike),
                card("dip", "Dippy", usd=dip, rank=50),
                card("flat", "Flat", usd=5, foil=12),
                card("cheap", "Cheap", usd=0.1),
                card("digital", "Online", usd=50, digital=True),
                card("jp", "Japanese", usd=50, lang="ja"),
            ])
        feed, hist = self.run_days(days)
        self.assertEqual(feed["historyDays"], 9)
        self.assertEqual(feed["scanned"], 4)
        rows = {(r["id"], r["finish"]): r for r in feed["entries"]}
        spike = rows[("spike", "nonfoil")]
        self.assertEqual(spike["d1"], 100.0)
        self.assertIn("up1", spike["lists"])
        self.assertIn("up7", spike["lists"])
        self.assertEqual(spike["signal"], "sell")
        self.assertEqual(spike["name"], "Spiky")
        self.assertEqual(spike["tcgplayer"], "https://tcg/spike")
        dip = rows[("dip", "nonfoil")]
        self.assertEqual(dip["d7"], -37.5)
        self.assertEqual(dip["signal"], "buy")
        self.assertNotIn(("flat", "nonfoil"), rows)
        self.assertNotIn("cheap:n", hist["p"])
        self.assertEqual(len(hist["p"]["flat:f"]), 9)

    def test_same_day_rerun_and_rollover(self):
        days = [[card("a", "A", usd=5)] for _ in range(build_feed.HISTORY_DAYS + 3)]
        _, hist = self.run_days(days)
        self.assertEqual(len(hist["dates"]), build_feed.HISTORY_DAYS)
        self.assertEqual(len(hist["p"]["a:n"]), build_feed.HISTORY_DAYS)

    def test_new_card_padding(self):
        feed, hist = self.run_days([[card("a", "A", usd=5)], [card("a", "A", usd=5), card("b", "B", usd=9)]])
        self.assertEqual(hist["p"]["b:n"], [None, 9.0])


if __name__ == "__main__":
    unittest.main()
