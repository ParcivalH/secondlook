"use client";

// Owner view: start a transfer (Figma section 2: "Owner initiates a transfer, signed with a software wallet").
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { TOKENS, findToken } from "@/lib/tokens";
import { buildTransfer } from "@/lib/buildTransfer";
import { connectOwnerWallet, openSafe } from "@/lib/wallet";
import { GUARDIAN_NAME, SAFE_ADDRESS } from "@/lib/config";
import type { RiskResult } from "@/lib/risk";

export default function NewTransfer() {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [symbol, setSymbol] = useState("ETH");
  // Behavior signals from the Figma flow
  const [addressPasted, setAddressPasted] = useState(false);
  const [amountEdits, setAmountEdits] = useState(0);

  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function validate() {
    if (!isAddress(recipient)) return "Recipient is not a valid 0x address";
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return "Amount must be a positive number";
    return "";
  }

  // Step 1: agent risk check
  async function review() {
    const problem = validate();
    if (problem) return setError(problem);
    setError("");
    setBusy("Checking...");
    try {
      const res = await fetch("/api/risk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient, amount, token: symbol, addressPasted, amountEdits, hour: new Date().getHours() }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setRisk(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  // Step 2: owner signs with MetaMask (signature 1 of 2), server proposes to Safe
  async function signAndSend() {
    const token = findToken(symbol);
    if (!token || !risk) return;
    setError("");
    try {
      setBusy("Connecting wallet...");
      const owner = await connectOwnerWallet();
      const kit = await openSafe(owner);

      const safeTx = await kit.createTransaction({ transactions: [buildTransfer(token, recipient, amount)] });
      const safeTxHash = await kit.getTransactionHash(safeTx);

      setBusy("Please sign in MetaMask...");
      const signed = await kit.signTransaction(safeTx, "eth_signTypedData_v4");
      const signature = signed.getSignature(owner);
      if (!signature) throw new Error("MetaMask did not return a signature");

      setBusy("Sending to " + GUARDIAN_NAME + "...");
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient,
          amount,
          token: symbol,
          risk,
          safeTxHash,
          safeTransactionData: safeTx.data,
          senderAddress: owner,
          senderSignature: signature.data,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      router.push(`/transfer?tx=${out.safeTxHash}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  return (
    <main>
      <h1>Send from your protected savings</h1>
      <p className="muted">Ethereum Sepolia testnet · Safe <span className="mono">{SAFE_ADDRESS}</span></p>

      <section className="card">
        <label>Recipient address</label>
        <input
          className="mono"
          placeholder="0x..."
          value={recipient}
          onPaste={() => setAddressPasted(true)}
          onChange={(e) => { setRecipient(e.target.value.trim()); setRisk(null); }}
        />

        <label>Amount</label>
        <div className="row">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.trim()); setAmountEdits((n) => n + 1); setRisk(null); }}
          />
          <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setRisk(null); }}>
            {TOKENS.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>

        {!risk && <button onClick={review} disabled={!!busy}>Continue</button>}
      </section>

      {risk && (
        <section className="card">
          <p>
            Risk check: <span className={`badge ${risk.level}`}>{risk.level}</span>
          </p>
          {risk.signals.length > 0 ? (
            <ul>{risk.signals.map((s) => <li key={s}>{s}</li>)}</ul>
          ) : (
            <p className="muted">No unusual signals found.</p>
          )}
          <p className="muted">
            This Safe needs {GUARDIAN_NAME}&apos;s confirmation on her Ledger for every transfer. Your money does not move until she approves.
          </p>
          <button onClick={signAndSend} disabled={!!busy}>Sign with MetaMask &amp; send to {GUARDIAN_NAME}</button>
          <button className="secondary" onClick={() => setRisk(null)} disabled={!!busy}>Edit</button>
        </section>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}