/**
 * Operations: Decay, Consolidate, Reindex. Decay and Consolidate run a
 * dry-run preview (apply:false) first, then an Apply button (red, confirmed)
 * posts apply:true and shows the run summary. Reindex posts directly. After
 * any apply, parent refreshes stats + activity.
 */
import { useState } from "react";
import {
  api,
  type ConsolidationSummary,
  type DecaySummary,
  type ReindexSummary,
} from "../api";
import { TierChip } from "../components/primitives";
import type { Tier } from "../api";

export function Operations({ onApplied }: { onApplied?: () => void }) {
  return (
    <div className="view">
      <div className="view-head">
        <h1>Operations</h1>
        <span className="sub">decay · consolidate · reindex</span>
      </div>

      <div className="ops-grid">
        <DecayCard onApplied={onApplied} />
        <ConsolidateCard onApplied={onApplied} />
        <ReindexCard onApplied={onApplied} />
      </div>
    </div>
  );
}

function useError() {
  const [error, setError] = useState<string | null>(null);
  const wrap = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  return { error, setError, wrap };
}

function DecayCard({ onApplied }: { onApplied?: () => void }) {
  const [preview, setPreview] = useState<DecaySummary | null>(null);
  const [result, setResult] = useState<DecaySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, setError, wrap } = useError();

  async function dryRun() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api.opDecay(false));
    } catch (e) {
      wrap(e);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!window.confirm("Deprecate all forgettable memories? This rewrites their frontmatter.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.opDecay(true);
      setResult(r);
      setPreview(null);
      onApplied?.();
    } catch (e) {
      wrap(e);
    } finally {
      setBusy(false);
    }
  }

  const forgettableRows = (preview?.rows ?? []).filter((r) => r.forgettable);

  return (
    <div className="card op-card">
      <p className="card-title">Decay</p>
      <p className="desc">
        Run the Ebbinghaus forgetting pass. Memories below the deprecate threshold (and unpinned)
        become forgettable.
      </p>

      {error && <div className="banner-err">{error}</div>}

      {preview && !result && (
        <div className="preview">
          <div className="preview-stats">
            <Metric n={preview.evaluated} k="evaluated" />
            <Metric n={preview.forgettable} k="forgettable" red={preview.forgettable > 0} />
          </div>
          {forgettableRows.length > 0 && (
            <div className="preview-rows">
              {forgettableRows.slice(0, 50).map((r) => (
                <div className="prow" key={r.id}>
                  <TierChip tier={r.tier as Tier} />
                  <span className="pt">{r.title}</span>
                  <span className="mono muted">{(r.retention * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="preview">
          <div className="preview-stats">
            <Metric n={result.evaluated} k="evaluated" />
            <Metric n={result.deprecated} k="deprecated" red={result.deprecated > 0} />
          </div>
          <span className="mono muted" style={{ fontSize: 11 }}>
            applied · clock reset for survivors
          </span>
        </div>
      )}

      <div className="op-actions">
        <button className="btn btn-ghost" onClick={dryRun} disabled={busy}>
          {busy && !preview ? "Running…" : "Dry run"}
        </button>
        <button
          className="btn btn-red"
          onClick={apply}
          disabled={busy || !preview || preview.forgettable === 0}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function ConsolidateCard({ onApplied }: { onApplied?: () => void }) {
  const [preview, setPreview] = useState<ConsolidationSummary | null>(null);
  const [result, setResult] = useState<ConsolidationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, setError, wrap } = useError();

  async function dryRun() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api.opConsolidate(false));
    } catch (e) {
      wrap(e);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!window.confirm("Write consolidated semantic memories and mark sources as consolidated?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.opConsolidate(true);
      setResult(r);
      setPreview(null);
      onApplied?.();
    } catch (e) {
      wrap(e);
    } finally {
      setBusy(false);
    }
  }

  const active = result ?? preview;

  return (
    <div className="card op-card">
      <p className="card-title">Consolidate</p>
      <p className="desc">
        Cluster aged, reinforced episodic memories by similarity and promote each cluster into a
        durable semantic memory.
      </p>

      {error && <div className="banner-err">{error}</div>}

      {active && (
        <div className="preview">
          <div className="preview-stats">
            <Metric n={active.eligible} k="eligible" />
            <Metric n={active.clusters.length} k="clusters" />
            {result && <Metric n={result.written} k="written" red={result.written > 0} />}
          </div>
          {active.clusters.length > 0 && (
            <div className="preview-rows">
              {active.clusters.map((c, i) => (
                <div className="prow" key={i}>
                  <span className="mono" style={{ color: "var(--tier-semantic)" }}>
                    {c.sharedTokens.slice(0, 3).join(" · ") || "cluster"}
                  </span>
                  <span className="pt muted">{c.sourceIds.length} sources</span>
                </div>
              ))}
            </div>
          )}
          {active.clusters.length === 0 && (
            <span className="mono muted" style={{ fontSize: 11 }}>
              no clusters meet the threshold
            </span>
          )}
        </div>
      )}

      <div className="op-actions">
        <button className="btn btn-ghost" onClick={dryRun} disabled={busy}>
          {busy && !preview ? "Running…" : "Dry run"}
        </button>
        <button
          className="btn btn-red"
          onClick={apply}
          disabled={busy || !preview || preview.clusters.length === 0}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function ReindexCard({ onApplied }: { onApplied?: () => void }) {
  const [result, setResult] = useState<ReindexSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, setError, wrap } = useError();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.opReindex();
      setResult(r);
      onApplied?.();
    } catch (e) {
      wrap(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card op-card">
      <p className="card-title">Reindex</p>
      <p className="desc">
        Rebuild the BM25 search index from the markdown files. Safe and idempotent — no frontmatter
        is touched.
      </p>

      {error && <div className="banner-err">{error}</div>}

      {result && (
        <div className="preview">
          <div className="preview-stats">
            <Metric n={result.indexed} k="documents indexed" />
          </div>
        </div>
      )}

      <div className="op-actions">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? "Reindexing…" : "Reindex now"}
        </button>
      </div>
    </div>
  );
}

function Metric({ n, k, red }: { n: number; k: string; red?: boolean }) {
  return (
    <div className="s">
      <div className={`n${red ? " red" : ""}`}>{n}</div>
      <div className="k">{k}</div>
    </div>
  );
}
