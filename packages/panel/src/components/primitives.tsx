/**
 * Reusable presentational primitives: tier chip, status pill, retention bar.
 * Kept tiny and dependency-free so every view shares the same vocabulary.
 */
import type { MemoryStatus, Tier } from "../api";
import { TIER_COLOR } from "../api";

export function TierChip({ tier }: { tier: Tier }) {
  return (
    <span className="chip">
      <span className="swatch" style={{ background: TIER_COLOR[tier] }} />
      {tier}
    </span>
  );
}

export function StatusPill({ status }: { status: MemoryStatus }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

/**
 * Signature element: a thin retention bar that depletes with retention. Width
 * tracks retention; color shifts from healthy green toward red as it empties.
 */
export function RetentionBar({ retention }: { retention: number }) {
  const r = clamp01(retention);
  return (
    <div className="retbar" title={`retention ${(r * 100).toFixed(0)}%`}>
      <span style={{ width: `${r * 100}%`, background: retentionColor(r) }} />
    </div>
  );
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Healthy → empty color ramp. Stays red-forward (the brand): a full bar is a
 * desaturated green, but it tips to accent red well before it empties so a
 * decaying memory reads as a red warning at a glance.
 */
export function retentionColor(r: number): string {
  const x = clamp01(r);
  if (x >= 0.6) return "var(--ok)";
  if (x >= 0.3) return "var(--warn)";
  return "var(--accent)";
}

export function pct(n: number): string {
  return `${Math.round(clamp01(n) * 100)}%`;
}
