/**
 * Right-side detail drawer for a single memory. Fetches GET /api/memories/:id,
 * renders the body, a retention gauge, typed links, and a red Reinforce action
 * that POSTs and refreshes. Shared by the Memories table and the Graph view.
 */
import { useEffect, useState } from "react";
import { api, type MemoryDetail } from "../api";
import { RetentionBar, StatusPill, TierChip, pct, retentionColor } from "./primitives";

interface Props {
  id: string;
  onClose: () => void;
  /** Called after a successful reinforce so parent views can refresh. */
  onReinforced?: () => void;
}

export function MemoryDrawer({ id, onClose, onReinforced }: Props) {
  const [mem, setMem] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    api
      .memory(id)
      .then(setMem)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    setMem(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function reinforce() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await api.reinforce(id);
      // Server returns frontmatter fields + retention; merge to keep body/links.
      setMem((prev) => (prev ? { ...prev, ...updated } : prev));
      onReinforced?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Memory detail">
        <header className="drawer-head">
          <div className="row">
            {mem && <TierChip tier={mem.tier} />}
            {mem && <StatusPill status={mem.status} />}
            <button className="x-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <h2>{mem ? mem.title : "Loading…"}</h2>
          <div className="drawer-id mono">{id}</div>
        </header>

        <div className="drawer-body">
          {error && <div className="banner-err">{error}</div>}
          {!mem && !error && <div className="spin">Loading memory…</div>}

          {mem && (
            <>
              <div className="section-label">Retention</div>
              <div className="gauge">
                <div className="pct mono" style={{ color: retentionColor(mem.retention) }}>
                  {pct(mem.retention)}
                </div>
                <div className="track">
                  <span
                    style={{
                      width: pct(mem.retention),
                      background: retentionColor(mem.retention),
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 4 }}>
                <RetentionBar retention={mem.retention} />
              </div>

              <dl className="kv">
                <dt>Type</dt>
                <dd>{mem.type}</dd>
                <dt>Confidence</dt>
                <dd>{mem.confidence}</dd>
                <dt>Importance</dt>
                <dd>{mem.importance}/10</dd>
                <dt>Strength</dt>
                <dd>×{mem.strength}</dd>
                <dt>Created</dt>
                <dd>{mem.created}</dd>
                <dt>Reinforced</dt>
                <dd>{mem.last_reinforced}</dd>
              </dl>

              {mem.tags.length > 0 && (
                <>
                  <div className="section-label">Tags</div>
                  <div className="tags">
                    {mem.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {mem.summary && (
                <>
                  <div className="section-label">Summary</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{mem.summary}</div>
                </>
              )}

              <div className="section-label">Body</div>
              <div className="mdbody">{mem.body.trim() || "— empty —"}</div>

              <div className="section-label">Links ({mem.links.length})</div>
              {mem.links.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  No outbound links.
                </div>
              ) : (
                <div className="linklist">
                  {mem.links.map((l, i) => (
                    <div className="linkrow" key={`${l.to}-${i}`}>
                      <span className="rel">{l.rel}</span>
                      <span className="lt">{l.title}</span>
                      <span className="drawer-id mono" style={{ marginLeft: "auto" }}>
                        {l.to}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 22 }}>
                <button className="btn btn-red" onClick={reinforce} disabled={busy}>
                  {busy ? "Reinforcing…" : "Reinforce"}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
