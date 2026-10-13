"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type State } from "./api";
import { Dad } from "./Dad";
import { Mia } from "./Mia";
import { Ctx } from "./shared";

type View = "both" | "dad" | "mia";
const viewFromHash = (): View => (typeof location !== "undefined" && ["dad", "mia"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as View) : "both");

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<View>("both");

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  // Dad and Mia may be on different devices: both follow the agent's shared state.
  useEffect(() => {
    refresh();
    setView(viewFromHash());
    const t = setInterval(refresh, 1500);
    const onHash = () => setView(viewFromHash());
    addEventListener("hashchange", onHash);
    return () => {
      clearInterval(t);
      removeEventListener("hashchange", onHash);
    };
  }, [refresh]);

  const owner = state?.names.owner ?? "Dad";
  const guardian = state?.names.guardian ?? "Mia";
  const clockH = state ? Math.round((state.now - Date.now()) / 3_600_000) : 0;

  return (
    <div className="wrap">
      <div className="bar">
        <div className="brand">
          <img src="/icon.svg" alt="" style={{ width: 34, height: 34 }} />
          <span className="wordmark">Second Look</span>
        </div>
        <nav className="tabs" aria-label="View">
          {(["both", "dad", "mia"] as View[]).map((v) => (
            <a key={v} className="tab" href={`#${v}`} aria-current={view === v ? "page" : undefined}>
              {v === "both" ? "Side by side" : v === "dad" ? `${owner}'s phone` : `${guardian}'s laptop`}
            </a>
          ))}
        </nav>
      </div>
      <div className="demo" aria-label="Demo controls">
        <span className={`badge ${state?.ai ? "ai" : ""}`}>{state?.ai ? `Lumi: ${state.ai.model}` : "Lumi: scripted (no API key)"}</span>
        {state?.mode === "live" && <span className="badge ai">Live on Sepolia · Safe {state.safe?.slice(0, 6)}…{state.safe?.slice(-4)}</span>}
        <a className="tab" href="/setup">
          {state?.mode === "live" ? "Change Safe" : "Use my Safe (live)"}
        </a>
        {state?.mode === "live" && (
          <button className="tab" type="button" onClick={() => api.clearSetup().then(refresh)}>
            Back to demo
          </button>
        )}
        <span>{offline ? "Can't reach the server: run npm run dev" : clockH ? `Demo clock: +${clockH} hours` : "Demo clock: now"}</span>
        <button className="tab" type="button" onClick={() => api.clock(4).then(refresh)}>
          +4 hours
        </button>
        <button className="tab" type="button" onClick={() => api.clock(20).then(refresh)}>
          +20 hours
        </button>
        {state?.mode !== "live" && (
          <button className="tab" type="button" onClick={() => api.reset().then(refresh)}>
            Reset demo
          </button>
        )}
      </div>
      {state ? (
        <Ctx.Provider value={{ state, refresh }}>
          <div className={`stage ${view === "both" ? "" : "single"}`}>
            {view !== "mia" && (
              <section className="col dad" aria-label={`${owner}'s phone`}>
                <span className="label">{owner}&apos;s phone</span>
                <div className="phone">
                  <Dad />
                </div>
              </section>
            )}
            {view !== "dad" && (
              <section className="col mia" aria-label={`${guardian}'s laptop`}>
                <span className="label">{guardian}&apos;s laptop, with her Ledger</span>
                <div className="laptop">
                  <Mia />
                </div>
              </section>
            )}
          </div>
        </Ctx.Provider>
      ) : (
        <p className="hint">{offline ? "Can't reach the server. Run npm run dev, then reload." : "Loading…"}</p>
      )}
      <p className="hint">
        Dad and Mia can be on different devices; both follow the same account. In demo mode the wallet and Ledger steps are simulated. In live mode (your Safe from /setup) Dad signs in MetaMask, Mia approves on her Ledger with one tap that also executes the transfer, and the 2-of-2 Safe on Sepolia enforces it.
      </p>
    </div>
  );
}
