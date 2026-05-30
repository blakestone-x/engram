/**
 * Memories: filterable/sortable table over GET /api/memories. Each row shows
 * title, tier chip, type, strength, importance, and the signature retention
 * bar. Clicking a row opens the shared detail drawer.
 */
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type MemoryListItem,
  type MemoryQuery,
  type MemoryStatus,
  type Tier,
  TIERS,
} from "../api";
import { RetentionBar, StatusPill, TierChip } from "../components/primitives";
import { MemoryDrawer } from "../components/MemoryDrawer";

const STATUSES: MemoryStatus[] = ["active", "consolidated", "deprecated", "disputed"];
const SORTS: MemoryQuery["sort"][] = ["retention", "strength", "importance", "title"];

export function Memories() {
  const [rows, setRows] = useState<MemoryListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const [tier, setTier] = useState<Tier | "">("");
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<MemoryStatus | "">("");
  const [sort, setSort] = useState<NonNullable<MemoryQuery["sort"]>>("retention");
  const [q, setQ] = useState("");

  function load() {
    setLoading(true);
    setError(null);
    api
      .memories({ tier, status, sort, q, limit: 500 })
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  // tier/status/sort/q go to the server; type is filtered client-side so the
  // dropdown can be populated from whatever types actually exist.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, status, sort, q]);

  const types = useMemo(
    () => Array.from(new Set(rows.map((r) => r.type))).sort(),
    [rows],
  );
  const shown = useMemo(
    () => (type ? rows.filter((r) => r.type === type) : rows),
    [rows, type],
  );

  return (
    <div className="view">
      <div className="view-head">
        <h1>Memories</h1>
        <span className="sub">{shown.length} shown</span>
      </div>

      <div className="filters">
        <Select label="Tier" value={tier} onChange={(v) => setTier(v as Tier | "")}>
          <option value="">all</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>

        <Select label="Type" value={type} onChange={setType}>
          <option value="">all</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>

        <Select
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as MemoryStatus | "")}
        >
          <option value="">all</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select
          label="Sort"
          value={sort}
          onChange={(v) => setSort(v as NonNullable<MemoryQuery["sort"]>)}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <div className="spacer" />
        <input
          placeholder="filter title / summary"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="banner-err">{error}</div>}

      <div className="mtable">
        <div className="mrow head">
          <div>Memory</div>
          <div>Tier</div>
          <div>Type · Status</div>
          <div style={{ textAlign: "right" }}>Strength</div>
          <div style={{ textAlign: "right" }}>Imp.</div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="empty">No memories match these filters.</div>
        ) : (
          shown.map((m) => (
            <div className="mrow" key={m.id} onClick={() => setOpenId(m.id)}>
              <div className="mcell-title">
                <div className="t">{m.title}</div>
                {m.summary && <div className="sum">{m.summary}</div>}
                <div className="bar-wrap">
                  <RetentionBar retention={m.retention} />
                </div>
              </div>
              <div>
                <TierChip tier={m.tier} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {m.type}
                </span>
                <StatusPill status={m.status} />
              </div>
              <div className="num">×{m.strength}</div>
              <div className="num">{m.importance}</div>
            </div>
          ))
        )}
      </div>

      {openId && (
        <MemoryDrawer id={openId} onClose={() => setOpenId(null)} onReinforced={load} />
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
