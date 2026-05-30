/**
 * Panel shell: a left rail with four views (Overview, Memories, Graph,
 * Operations) and a loopback health indicator. Talks only to the core API.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Overview } from "./views/Overview";
import { Memories } from "./views/Memories";
import { Graph } from "./views/Graph";
import { Operations } from "./views/Operations";

type ViewId = "overview" | "memories" | "graph" | "operations";

const NAV: { id: ViewId; label: string; ix: string }[] = [
  { id: "overview", label: "Overview", ix: "01" },
  { id: "memories", label: "Memories", ix: "02" },
  { id: "graph", label: "Graph", ix: "03" },
  { id: "operations", label: "Operations", ix: "04" },
];

export default function App() {
  const [view, setView] = useState<ViewId>("overview");
  // Bump to force remount of a view after an op mutates the vault.
  const [epoch, setEpoch] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      api
        .stats()
        .then(() => alive && setOnline(true))
        .catch(() => alive && setOnline(false));
    ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          <span className="mark">
            engram<span className="dot">.</span>
          </span>
          <span className="ver">v0.1.0</span>
        </div>

        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item${view === n.id ? " active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <span className="ix">{n.ix}</span>
            {n.label}
          </button>
        ))}

        <div className="rail-foot">
          <span className={`dot-live${online === false ? " dot-dead" : ""}`} />
          {online === null ? "connecting" : online ? "127.0.0.1 · live" : "offline"}
        </div>
      </nav>

      <main className="main">
        {view === "overview" && <Overview key={`ov-${epoch}`} />}
        {view === "memories" && <Memories key={`mem-${epoch}`} />}
        {view === "graph" && <Graph key={`gr-${epoch}`} />}
        {view === "operations" && <Operations key="ops" onApplied={refresh} />}
      </main>
    </div>
  );
}
