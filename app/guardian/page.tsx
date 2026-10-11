"use client";

// Guardian view (Figma section 4 + Screen 4): see transfers waiting for you, read the risk brief,
// then approve or reject on your Ledger. The page finds new transfers by itself (polls every 5s).
import { useCallback, useEffect, useState } from "react";
import { etherscanTxUrl } from "@/lib/config";
import type { TransferRecord } from "@/lib/store";

type Pending = TransferRecord & { hoursLeft: number };

export default function GuardianPage() {
  const [guardian, setGuardian] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const refresh = useCallback(() => {
    if (busy) return; // don't poll the Ledger while it is signing
    fetch("/api/guardian")
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!ok) return setError(body.error);
        setError("");
        setGuardian(body.guardian);
        setPending(body.pending);
      })
      .catch(() => setError("Could not reach the server"));
  }, [busy]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 5_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

  async function act(action: "approve" | "reject", t: Pending) {
    setError("");
    setDone("");
    setBusy(
      action === "approve"
        ? "Check the details on your Ledger and approve (emulator: localhost:5001). The transfer is sent as soon as you approve..."
        : "Confirm the rejection on your Ledger (emulator: localhost:5001)...",
    );
    try {
      const res = await fetch("/api/guardian", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, safeTxHash: t.safeTxHash }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setDone(
        action === "approve"
          ? `Approved. ${t.amount} ${t.token} sent. ${out.executionTxHash ? etherscanTxUrl(out.executionTxHash) : ""}`
          : `Rejected. No money moved. ${t.ownerName} will see that the transfer was stopped.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <main>
      <h1>Guardian</h1>
      <p className="muted">
        Your Ledger: <span className="mono">{guardian || "connecting..."}</span>
        <br />You can only approve or decline. Doing nothing never sends money: requests expire after 24h.
      </p>

      {pending.length === 0 && !error && <section className="card"><p className="muted">Nothing waiting for you. This page checks every few seconds.</p></section>}

      {pending.map((t) => (
        <section className="card" key={t.safeTxHash}>
          <p>
            <span className={`badge ${t.risk?.level}`}>{t.risk?.level} risk</span>{" "}
            <strong>{t.ownerName}</strong> is trying to send <strong>{t.amount} {t.token}</strong>. Your approval is needed.
          </p>
          <p className="mono">to {t.recipient}</p>

          <p><strong>Why we flagged it</strong></p>
          {t.risk?.signals?.length ? <ul>{t.risk.signals.map((s) => <li key={s}>{s}</li>)}</ul> : <p className="muted">No unusual signals.</p>}

          <p className="muted">When in doubt, call {t.ownerName} first. Expires in {t.hoursLeft}h. If you do nothing, no money moves.</p>
          <p className="muted mono">Transfer ID {t.safeTxHash}</p>

          <button onClick={() => act("reject", t)} disabled={!!busy} className="secondary">Reject on Ledger</button>
          <button onClick={() => act("approve", t)} disabled={!!busy}>Approve on Ledger</button>
        </section>
      ))}

      {busy && <p className="muted">{busy}</p>}
      {done && <p style={{ wordBreak: "break-all" }}>{done}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
