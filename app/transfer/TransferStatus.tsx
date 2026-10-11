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
  status: "waiting" | "ready" | "executed" | "cancelled" | "expired" | "blocked";
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
        {s.status === "blocked" && (
          <>
            <h3>This transfer didn&apos;t go through. Your {r.amount} {r.token} is safe.</h3>
            <p>{g} declined it on their Ledger. We know this might be frustrating. You didn&apos;t do anything wrong; these situations are designed by professionals to feel real.</p>
            <p className="muted">
              Never pay a tax, fee or deposit to withdraw. Beware anyone offering to recover lost money, a common second scam.
              Report at <a href="https://www.ic3.gov" target="_blank" rel="noreferrer">ic3.gov</a>.
            </p>
          </>
        )}
        {s.status === "expired" && (
          <>
            <h3>{g} didn&apos;t respond in time, so the transfer was cancelled.</h3>
            <p>Your funds never left. You can start it again anytime.</p>
          </>
        )}
        <p className="muted"><a href={safeQueueUrl(r.safeAddress)} target="_blank" rel="noreferrer">Open in Safe</a> · <Link href="/classic">New transfer</Link></p>
      </section>

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
