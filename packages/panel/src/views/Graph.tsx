/**
 * Graph: a d3-force link graph over GET /api/graph rendered to SVG. Nodes are
 * colored by tier, sized by strength, faded by retention. Edges are thin grey.
 * Clicking a node opens its drawer.
 */
import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { api, type GraphData, type Tier, TIERS, TIER_HEX } from "../api";
import { clamp01 } from "../components/primitives";
import { MemoryDrawer } from "../components/MemoryDrawer";

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tier: Tier;
  strength: number;
  retention: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  rel: string;
}

const W = 1080;
const H = 620;

export function Graph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, force] = useState(0); // tick re-render trigger
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);

  useEffect(() => {
    api
      .graph()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.nodes.map((n) => n.id));
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, rel: e.rel }));
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(70)
          .strength(0.4),
      )
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => radius(d.strength) + 4))
      .on("tick", () => force((n) => n + 1));

    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [data]);

  const empty = data && data.nodes.length === 0;

  return (
    <div className="view">
      <div className="view-head">
        <h1>Graph</h1>
        <span className="sub">
          {data ? `${data.nodes.length} nodes · ${data.edges.length} edges` : "…"}
        </span>
      </div>

      {error && <div className="banner-err">{error}</div>}
      {!data && !error && <div className="spin">Loading graph…</div>}

      {data && (
        <div className="graph-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: H }}>
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-mute)" />
              </marker>
            </defs>

            {linksRef.current.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (s?.x == null || t?.x == null) return null;
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke="var(--border)"
                  strokeWidth={1}
                  markerEnd="url(#arrow)"
                  opacity={0.7}
                />
              );
            })}

            {nodesRef.current.map((n) => {
              if (n.x == null) return null;
              const r = radius(n.strength);
              const op = 0.35 + 0.65 * clamp01(n.retention);
              return (
                <g key={n.id} className="graph-node" onClick={() => setOpenId(n.id)}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={TIER_HEX[n.tier]}
                    fillOpacity={op}
                    stroke="var(--bg)"
                    strokeWidth={1}
                  />
                  {r >= 9 && (
                    <text
                      x={n.x}
                      y={(n.y ?? 0) + r + 11}
                      textAnchor="middle"
                      style={{ fontSize: 9, fill: "var(--text-mute)", pointerEvents: "none" }}
                    >
                      {trunc(n.title)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {empty && <div className="empty">No memories to graph yet.</div>}

          <div className="graph-legend">
            {TIERS.map((t) => (
              <span className="li" key={t}>
                <span className="sw" style={{ background: TIER_HEX[t] }} />
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {openId && <MemoryDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function radius(strength: number): number {
  return 5 + Math.min(14, Math.sqrt(Math.max(0, strength)) * 3);
}

function trunc(s: string): string {
  return s.length > 22 ? `${s.slice(0, 21)}…` : s;
}
