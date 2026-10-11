"use client";

// Owner waiting page + results (Figma Screen 5 and Screen 6).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { etherscanTxUrl, safeQueueUrl } from "@/lib/config";
import { connectOwnerWallet, openSafe } from "@/lib/wallet";
import type { TransferRecord } from "@/lib/store";

type Status = {
  record: TransferRecord;
  status: "waiting" | "ready" | "executed" | "cancelled" | "expired";
  confirmations: number;
  threshold: number;
  executionTxHash: string | null;
  hoursLeft: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
};

export function TransferStatus() {
  const safeTxHash = useSearchParams().get("tx") ?? "";
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      fetch(`/api/transfers?safeTxHash=${safeTxHash}`)
        .then(async (r) => ({ ok: r.ok, body: await r.json() }))
        .then(({ ok, body }) => (ok ? setS(body) : setError(body.error))),
    [safeTxHash],
  );

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 10_000); // pick up the guardian's signature
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

  async function cancel() {
    await fetch("/api/transfers/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ safeTxHash }) });
    refresh();
  }

  async function execute() {
    if (!s) return;
    setError("");
    try {
      setBusy("Confirm the transaction in MetaMask (pays gas)...");
      const owner = await connectOwnerWallet();
      const kit = await openSafe(owner, s.record.safeAddress);
      await kit.executeTransaction(s.tx);
      setBusy("Waiting for the network...");
      setTimeout(() => { setBusy(""); refresh(); }, 15_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  if (!s) return <main><p className="muted">{error || "Loading..."}</p></main>;
  const r = s.record;
  const g = r.guardianName;

  return (
    <main>
      <section className="card">
        <p className="muted">Transfer</p>
        <h2 style={{ margin: "4px 0" }}>{r.amount} {r.token}</h2>
        <p className="mono">to {r.recipient}</p>
        <p>Risk check: <span className={`badge ${r.risk?.level}`}>{r.risk?.level}</span></p>
        <p className="muted">Confirmations: {s.confirmations} / {s.threshold}</p>
                <p className="muted">Transfer ID (safeTxHash):</p>
        <p className="mono">{safeTxHash}</p>
        {s.status === "waiting" && (
          <p className="muted">
            Guardian command:<br />
            <span className="mono">node --env-file=.env.local scripts/4-guardian-approve-and-execute.cjs {safeTxHash}</span>
          </p>
        )}
      </section>

      <section className="card">
        {s.status === "waiting" && (
          <>
            <h3>Waiting for {g}&apos;s confirmation</h3>
            <p>Your money is safe and on hold. {s.hoursLeft} hours left.</p>
            <p className="muted">If {g} doesn&apos;t respond, the transfer is cancelled and nothing is sent. If someone says this has to happen right now, that&apos;s worth a pause.</p>
            <button className="secondary" onClick={cancel}>Cancel transfer</button>
          </>
        )}
        {s.status === "ready" && (
          <>
            <h3>{g} approved on their Ledger</h3>
            <p>Both confirmations received. Send it now.</p>
            <button onClick={execute} disabled={!!busy}>Send now</button>
          </>
        )}
        {s.status === "executed" && (
          <>
            <h3>Both confirmations received. Transfer sent.</h3>
            {s.executionTxHash && <p><a href={etherscanTxUrl(s.executionTxHash)} target="_blank" rel="noreferrer">View on Etherscan</a></p>}
          </>
        )}
        {s.status === "cancelled" && <h3>You stopped it yourself.</h3>}
        {s.status === "expired" && (
          <>
            <h3>{g} didn&apos;t respond in time, so the transfer was cancelled.</h3>
            <p>Your funds never left. You can start it again anytime.</p>
          </>
        )}
        <p className="muted"><a href={safeQueueUrl(r.safeAddress)} target="_blank" rel="noreferrer">Open in Safe</a> · <Link href="/">New transfer</Link></p>
      </section>

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}