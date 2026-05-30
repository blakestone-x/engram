/**
 * Run-log activity feed. Renders RunEvent rows from GET /api/runs, summarizing
 * each event's detail into a one-line human description.
 */
import type { RunEvent } from "../api";

export function ActivityFeed({ runs, empty }: { runs: RunEvent[]; empty?: string }) {
  if (runs.length === 0) {
    return <div className="empty">{empty ?? "No activity."}</div>;
  }
  return (
    <div className="feed">
      {runs.map((r, i) => (
        <div className="feed-item" key={`${r.at}-${i}`}>
          <span className={`feed-kind ${r.kind}`}>{r.kind}</span>
          <span className="feed-detail">{describe(r)}</span>
          <span className="feed-at">{relTime(r.at)}</span>
        </div>
      ))}
    </div>
  );
}

function describe(r: RunEvent): string {
  const d = r.detail ?? {};
  switch (r.kind) {
    case "decay": {
      const dep = num(d.deprecated);
      const ev = num(d.evaluated);
      const fg = num(d.forgettable);
      if (d.applied) return `deprecated ${dep} of ${ev} evaluated`;
      return `dry run · ${fg} forgettable of ${ev}`;
    }
    case "consolidate": {
      const w = num(d.written);
      const c = Array.isArray(d.clusters) ? d.clusters.length : num(d.clusters);
      if (d.applied) return `wrote ${w} semantic memor${w === 1 ? "y" : "ies"} from ${c} cluster${c === 1 ? "" : "s"}`;
      return `dry run · ${c} cluster${c === 1 ? "" : "s"} eligible`;
    }
    case "reinforce": {
      const ids = Array.isArray(d.ids) ? d.ids.length : num(d.count ?? 1);
      const by = typeof d.by === "string" ? ` (${d.by})` : "";
      return `reinforced ${ids} memor${ids === 1 ? "y" : "ies"}${by}`;
    }
    case "reindex": {
      const n = num(d.indexed);
      return `reindexed ${n} document${n === 1 ? "" : "s"}`;
    }
    default:
      return JSON.stringify(d);
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}
