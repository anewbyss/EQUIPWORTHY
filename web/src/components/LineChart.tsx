import { useMemo, useRef, useState } from "react";
import type { PriceSeries } from "../lib/types";
import { usd } from "../lib/deckstats";

const RANGES: [string, number][] = [
  ["7D", 7],
  ["30D", 30],
  ["90D", 90],
  ["1Y", 365],
  ["All", 100000],
];

/** Single-series price line with crosshair tooltip and range selector. */
export function LineChart({ series, height = 220, label = "Price" }: { series: PriceSeries; height?: number; label?: string }) {
  const [range, setRange] = useState(90);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const width = 640;
  const pad = { l: 56, r: 12, t: 12, b: 24 };

  const data = useMemo(() => {
    if (!series.length) return [];
    const last = Date.parse(series[series.length - 1][0]);
    return series.filter(([d]) => last - Date.parse(d) <= range * 86_400_000);
  }, [series, range]);

  const chooser = (
    <div className="seg" role="group" aria-label="Time range">
      {RANGES.map(([l, d]) => (
        <button key={l} className={range === d ? "on" : ""} onClick={() => setRange(d)}>
          {l}
        </button>
      ))}
    </div>
  );

  if (data.length < 2) {
    return (
      <div className="chart">
        {chooser}
        <div className="chart-empty muted">
          {series.length < 2
            ? "Price history builds up as you refresh prices. EquipWorthy records one snapshot per day."
            : "Not enough points in this range."}
        </div>
      </div>
    );
  }

  const xs = data.map(([d]) => Date.parse(d));
  const ys = data.map(([, p]) => p);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y0 === y1) (y0 *= 0.95), (y1 *= 1.05);
  const padY = (y1 - y0) * 0.1;
  y0 = Math.max(0, y0 - padY);
  y1 += padY;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const path = data.map(([d, p], i) => `${i ? "L" : "M"}${sx(Date.parse(d)).toFixed(1)},${sy(p).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((t) => y0 + t * (y1 - y0));
  const first = ys[0], lastP = ys[ys.length - 1];
  const up = lastP >= first;

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(sx(xs[i]) - x) < Math.abs(sx(xs[best]) - x)) best = i;
    setHover(best);
  };

  const h = hover != null ? data[hover] : null;
  return (
    <div className="chart">
      <div className="row between">
        <span className="muted small">
          {label}: {usd(lastP)} <span className={up ? "up" : "down"}>({up ? "+" : ""}{(((lastP - first) / first) * 100).toFixed(1)}% in range)</span>
        </span>
        {chooser}
      </div>
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="chart-svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${label} history`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end" className="axis">
              {usd(t)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={height - 6} className="axis">{data[0][0]}</text>
        <text x={width - pad.r} y={height - 6} textAnchor="end" className="axis">{data[data.length - 1][0]}</text>
        <path d={path} className="line" />
        {h && (
          <g>
            <line x1={sx(Date.parse(h[0]))} x2={sx(Date.parse(h[0]))} y1={pad.t} y2={height - pad.b} className="crosshair" />
            <circle cx={sx(Date.parse(h[0]))} cy={sy(h[1])} r={4} className="dot" />
          </g>
        )}
      </svg>
      {h && (
        <div className="tooltip">
          {h[0]} · <b>{usd(h[1])}</b>
        </div>
      )}
    </div>
  );
}

export function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars">
      {values.map((v, i) => (
        <div key={i} className="bar-col" title={`${labels[i]}: ${v}`}>
          <span className="bar-val">{v || ""}</span>
          <div className="bar" style={{ height: `${(v / max) * 100}%` }} />
          <span className="bar-label">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
