import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Worker } from "tesseract.js";
import { PageHeader, Thumb } from "../components/ui";
import { usd } from "../lib/deckstats";
import { addPending } from "../lib/pending";
import { parseScan, similarity, type ScanHints } from "../lib/scanparse";
import * as scry from "../lib/scryfall";
import { useProfile } from "../lib/store";
import { priceFor, uid, type CardSummary, type Finish } from "../lib/types";

// Card guide inside the video frame (matches .scan-guide in styles.css)
const GUIDE = { top: 0.06, bottom: 0.06, left: 0.18, right: 0.18 };

async function lookup(h: ScanHints): Promise<CardSummary | null> {
  if (h.set && h.collectorNumber) {
    try {
      const c = await scry.bySetNumber(h.set, h.collectorNumber);
      if (!h.name || similarity(h.name, c.name) > 0.5) return c;
    } catch {
      /* fall through to name */
    }
  }
  if (h.name) {
    try {
      return await scry.named(h.name, true, h.set);
    } catch {
      try {
        return await scry.named(h.name, true);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.08);
    navigator.vibrate?.(40);
  } catch {
    /* audio not available */
  }
}

function crop(src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, scale = 2): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(w * sw * scale);
  c.height = Math.round(h * sh * scale);
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.6)";
  ctx.drawImage(src, x * sw, y * sh, w * sw, h * sh, 0, 0, c.width, c.height);
  return c;
}

export default function ScanPage() {
  const p = useProfile();
  const video = useRef<HTMLVideoElement>(null);
  const worker = useRef<Worker | null>(null);
  const [on, setOn] = useState(false);
  const [rapid, setRapid] = useState(true);
  const [finish, setFinish] = useState<Finish>("nonfoil");
  const [status, setStatus] = useState("Camera off");
  const [last, setLast] = useState<CardSummary | null>(null);
  const [hints, setHints] = useState<ScanHints | null>(null);
  const [session, setSession] = useState<CardSummary[]>([]);
  const busy = useRef(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => () => stop(), []);

  const getWorker = async () => {
    if (!worker.current) {
      setStatus("Loading text recognition…");
      const { createWorker } = await import("tesseract.js");
      worker.current = await createWorker("eng");
    }
    return worker.current;
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } });
      video.current!.srcObject = stream;
      await video.current!.play();
      setOn(true);
      setStatus("Line the card up inside the frame");
      await getWorker();
      setStatus("Ready");
    } catch (e) {
      setStatus(`Camera unavailable: ${(e as Error).message}. Try uploading a photo instead.`);
    }
  };

  function stop() {
    const s = video.current?.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    if (video.current) video.current.srcObject = null;
    setOn(false);
  }

  const recognize = async (src: CanvasImageSource, w: number, h: number, inGuide: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const wk = await getWorker();
      const g = inGuide ? GUIDE : { top: 0, bottom: 0, left: 0, right: 0 };
      const cx = g.left, cy = g.top, cw = 1 - g.left - g.right, ch = 1 - g.top - g.bottom;
      // Title bar: top ~4-11% of card; collector info: bottom-left ~3-9%
      const nameImg = crop(src, w, h, cx + cw * 0.04, cy + ch * 0.035, cw * 0.72, ch * 0.075);
      const infoImg = crop(src, w, h, cx + cw * 0.03, cy + ch * 0.9, cw * 0.5, ch * 0.08, 3);
      const [n, b] = [await wk.recognize(nameImg), await wk.recognize(infoImg)];
      const hh = parseScan(n.data.text, b.data.text);
      setHints(hh);
      if (!hh.name && !hh.collectorNumber) return setStatus("Couldn't read the card. Hold it steady with good light.");
      const card = await lookup(hh);
      if (!card) return setStatus(`No match for "${hh.name ?? ""}"`);
      setLast(card);
      if (card.id !== lastId.current || !rapid) {
        lastId.current = card.id;
        setSession((s) => [card, ...s]);
        const f: Finish = card.finishes.includes(finish) ? finish : card.finishes[0] ?? "nonfoil";
        addPending(
          [{ key: uid(), raw: `${hh.name ?? ""} ${hh.set ?? ""} ${hh.collectorNumber ?? ""}`.trim(), status: "ok", cardId: card.id, name: card.name, set: card.set, collectorNumber: card.collectorNumber, finish: f, condition: p.settings.defaultCondition, language: "en", quantity: 1, source: "scan" }],
          [card],
        );
        beep();
        setStatus(`Added ${card.name}`);
      }
    } catch (e) {
      setStatus(`Scan error: ${(e as Error).message}`);
    } finally {
      busy.current = false;
    }
  };

  const snap = () => {
    const v = video.current!;
    if (!v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    void recognize(c, c.width, c.height, true);
  };

  // Rapid mode: keep scanning
  useEffect(() => {
    if (!on || !rapid) return;
    const t = setInterval(snap, 1600);
    return () => clearInterval(t);
  }, [on, rapid, finish]);

  const onPhoto = async (f: File) => {
    const img = await createImageBitmap(f);
    lastId.current = null;
    await recognize(img, img.width, img.height, false);
  };

  return (
    <>
      <PageHeader title="Scan" sub="Point your camera at a card. Scanned cards go to the Batch Entry review queue." />
      <div className="grid2">
        <div className="card stack">
          <div className="scan-frame">
            <video ref={video} className="scan-video" playsInline muted />
            {on && <div className="scan-guide" />}
          </div>
          <div className="row gap">
            {!on ? <button className="btn primary" onClick={start}>Start camera</button> : <button className="btn" onClick={stop}>Stop</button>}
            {on && !rapid && <button className="btn primary" onClick={snap}>Scan card</button>}
            <label className="row gap small"><input type="checkbox" checked={rapid} onChange={(e) => setRapid(e.target.checked)} /> Rapid mode (auto-add)</label>
            <select value={finish} onChange={(e) => setFinish(e.target.value as Finish)} aria-label="Finish for scanned cards">
              <option value="nonfoil">Non-foil</option>
              <option value="foil">Foil</option>
              <option value="etched">Etched</option>
            </select>
          </div>
          <label className="small">
            Or upload a photo:{" "}
            <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && void onPhoto(e.target.files[0])} />
          </label>
          <p className="muted small">{status}</p>
          {hints && <p className="muted small">Read: name “{hints.name ?? "?"}” · set {hints.set?.toUpperCase() ?? "?"} · #{hints.collectorNumber ?? "?"}</p>}
          <p className="muted small">
            Tips: fill the frame, avoid glare on the title bar, and keep the bottom-left text in view. On cards from 2020 onward the set code and collector number identify the exact printing. Older cards match by name, and you choose the printing in review. Foil can't be detected from a photo, so set it with the selector above.
          </p>
        </div>
        <div>
          {last && (
            <div className="card row gap" style={{ alignItems: "flex-start" }}>
              <Thumb card={last} size={110} />
              <div>
                <h2><Link to={`/card/${last.id}`}>{last.name}</Link></h2>
                <p className="muted small">{last.setName} #{last.collectorNumber}</p>
                <p style={{ fontSize: "1.6rem", fontWeight: 700 }}>{usd(priceFor(last, finish))}</p>
              </div>
            </div>
          )}
          <div className="card">
            <div className="row between">
              <h2>This session ({session.length})</h2>
              <span>{usd(session.reduce((a, c) => a + (priceFor(c, finish) ?? 0), 0))}</span>
            </div>
            <ul className="small" style={{ paddingLeft: "1rem" }}>
              {session.map((c, i) => <li key={c.id + i}>{c.name} <span className="muted">{c.set.toUpperCase()} · {usd(priceFor(c, finish))}</span></li>)}
            </ul>
            <Link className="btn primary" to="/batch">Review &amp; add ({p.pendingBatch?.length ?? 0})</Link>
          </div>
        </div>
      </div>
    </>
  );
}
