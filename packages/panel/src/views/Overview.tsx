/**
 * Overview: stat cards, a hand-built decay-curve SVG (no chart lib), and the
 * recent-activity feed from GET /api/runs.
 */
import { useEffect, useState } from "react";
import { api, type RunEvent, type Stats, TIERS } from "../api";
import { pct } from "../components/primitives";
import { ActivityFeed } from "../components/ActivityFeed";

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.stats(), api.runs(25)])
      .then(([s, r]) => {
        setStats(s);
        setRuns(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="view">
      <div className="view-head">
        <h1>Overview</h1>
        <span className="sub">forgetting curve · {stats ? `${stats.total} memories` : "…"}</span>
      </div>

      {error && <div className="banner-err">{error}</div>}
      {!stats && !error && <div className="spin">Loading stats…</div>}

      {stats && (
        <>
          <div className="stat-grid">
            <Stat label="Total memories" value={String(stats.total)} />
            {TIERS.map((t) => (
              <Stat key={t} label={t} value={String(stats.byTier[t] ?? 0)} foot="tier" />
            ))}
            <Stat label="Avg retention" value={pct(stats.avgRetention)} />
            <Stat
              label="Decaying soon"
              value={String(stats.decayingSoon)}
              alert={stats.decayingSoon > 0}
              foot="below threshold"
            />
          </div>

          <div className="two-col">
            <div className="card">
              <p className="card-title">Decay curve — representative memory</p>
              <DecayCurve baseStability={14} deprecateThreshold={0.15} />
              <p
                className="mono"
                style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 10 }}
              >
                retention = exp(−t / S), S = 14 days · deprecate threshold 0.15
              </p>
            </div>

            <div className="card">
              <p className="card-title">Recent activity</p>
              <ActivityFeed runs={runs} empty="No runs recorded yet." />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  foot,
  alert,
}: {
  label: string;
  value: string;
  foot?: string;
  alert?: boolean;
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${alert ? " alert" : ""}`}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

/**
 * Hand-built SVG forgetting curve: retention = exp(-t / S) over a day window,
 * with a horizontal line at the deprecate threshold and a marker where the
 * curve crosses it. No chart library.
 */
function DecayCurve({
  baseStability,
  deprecateThreshold,
}: {
  baseStability: number;
  deprecateThreshold: number;
}) {
  const W = 560;
  const H = 200;
  const pad = { l: 34, r: 14, t: 12, b: 24 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  // x-axis: days; run out to where retention is ~0.05 so the tail is visible.
  const maxDays = Math.ceil(baseStability * Math.log(1 / 0.05));
  const x = (d: number) => pad.l + (d / maxDays) * innerW;
  const y = (r: number) => pad.t + (1 - r) * innerH;

  const samples = 80;
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const d = (i / samples) * maxDays;
    const r = Math.exp(-d / baseStability);
    points.push(`${x(d).toFixed(1)},${y(r).toFixed(1)}`);
  }
  const path = `M ${points.join(" L ")}`;
  const fillPath = `${path} L ${x(maxDays).toFixed(1)},${y(0).toFixed(1)} L ${x(0).toFixed(
    1,
  )},${y(0).toFixed(1)} Z`;

  // crossing point for the threshold
  const crossDay = baseStability * Math.log(1 / deprecateThreshold);
  const yGrid = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, Math.round(maxDays / 3), Math.round((2 * maxDays) / 3), maxDays];

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Decay curve">
      {/* y gridlines */}
      {yGrid.map((g) => (
        <g key={g}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(g)}
            y2={y(g)}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text x={pad.l - 6} y={y(g) + 3} textAnchor="end">
            {g.toFixed(2)}
          </text>
        </g>
      ))}
      {/* x ticks */}
      {xTicks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle">
          {t}d
        </text>
      ))}

      {/* area under curve */}
      <path d={fillPath} fill="color-mix(in srgb, var(--accent) 10%, transparent)" />
      {/* curve */}
      <path d={path} fill="none" stroke="var(--text-dim)" strokeWidth={1.6} />

      {/* deprecate threshold line (red) */}
      <line
        x1={pad.l}
        x2={W - pad.r}
        y1={y(deprecateThreshold)}
        y2={y(deprecateThreshold)}
        stroke="var(--accent)"
        strokeWidth={1.2}
        strokeDasharray="4 3"
      />
      <text x={W - pad.r} y={y(deprecateThreshold) - 5} textAnchor="end" fill="var(--accent)">
        deprecate {deprecateThreshold}
      </text>

      {/* crossing marker */}
      <circle cx={x(crossDay)} cy={y(deprecateThreshold)} r={3.5} fill="var(--accent)" />
      <text x={x(crossDay)} y={y(deprecateThreshold) + 16} textAnchor="middle" fill="var(--accent)">
        {crossDay.toFixed(0)}d
      </text>
    </svg>
  );
}
