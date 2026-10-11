"use client";

// Owner setup (Figma section 1 + Screen 1): choose the 2-of-2 Safe to protect and name your guardian.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { connectOwnerWallet } from "@/lib/wallet";
import { loadProfile, saveProfile } from "@/lib/profile";

type Checked = { safeAddress: string; owner: string; guardian: string };

export default function Setup() {
  const router = useRouter();
  const [owner, setOwner] = useState("");
  const [safes, setSafes] = useState<string[]>([]);
  const [safeInput, setSafeInput] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Prefill from a previous setup in this browser, or the one the server already has
  useEffect(() => {
    let cancelled = false;
    const fill = (p: { safeAddress: string; ownerName: string; guardianName: string }) => {
      if (cancelled) return;
      setSafeInput(p.safeAddress);
      setOwnerName(p.ownerName);
      setGuardianName(p.guardianName);
    };
    const p = loadProfile();
    if (p) setTimeout(() => fill(p), 0);
    else
      fetch("/api/sl/setup")
        .then((r) => r.json())
        .then((a) => a && fill(a))
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setError("");
    setBusy("Connecting wallet...");
    try {
      const me = await connectOwnerWallet();
      setOwner(me);
      setBusy("Looking up your Safes...");
      const res = await fetch(`/api/safe?owner=${me}`);
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setSafes(out.safes);
      if (out.safes.length === 1 && !safeInput) setSafeInput(out.safes[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function check(address: string) {
    setError("");
    setChecked(null);
    if (!isAddress(address)) return setError("Safe address is not a valid 0x address");
    setBusy("Checking the Safe...");
    try {
      const res = await fetch(`/api/safe?owner=${owner}&safe=${address}`);
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setChecked(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!checked) return;
    if (!ownerName.trim() || !guardianName.trim()) return setError("Please enter both names");
    setError("");
    setBusy("Saving...");
    try {
      // The server keeps the account too, so the guardian's laptop sees the same Safe and names
      const res = await fetch("/api/sl/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ safeAddress: checked.safeAddress, owner: checked.owner, ownerName: ownerName.trim(), guardianName: guardianName.trim() }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      saveProfile({
        safeAddress: out.safeAddress,
        ownerAddress: out.ownerAddress,
        ownerName: out.ownerName,
        guardianAddress: out.guardianAddress,
        guardianName: out.guardianName,
      });
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <main>
      <h1>Choose someone you trust to be your guardian</h1>
      <p className="muted">
        Your savings sit in a 2-of-2 Safe: you and your guardian. Every transfer needs your guardian to confirm on their Ledger.
        Your guardian can never move your money on their own.
      </p>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>1. Connect your wallet</h3>
        {owner ? <p className="mono">{owner}</p> : <button onClick={connect} disabled={!!busy}>Connect MetaMask</button>}
      </section>

      {owner && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>2. Your protected Safe (Sepolia)</h3>
          {safes.length > 0 ? (
            <>
              <p className="muted">Safes you own:</p>
              {safes.map((s) => (
                <label key={s} style={{ fontWeight: 400 }}>
                  <input type="radio" name="safe" checked={safeInput === s} onChange={() => { setSafeInput(s); setChecked(null); }} style={{ width: "auto", marginRight: 8 }} />
                  <span className="mono">{s}</span>
                </label>
              ))}
              <p className="muted">Or paste another address:</p>
            </>
          ) : (
            <p className="muted">No Safe found for this wallet. Create a 2-of-2 Safe at app.safe.global (you + your guardian&apos;s Ledger), then paste its address.</p>
          )}
          <input className="mono" placeholder="0x..." value={safeInput} onChange={(e) => { setSafeInput(e.target.value.trim()); setChecked(null); }} />
          <button onClick={() => check(safeInput)} disabled={!!busy || !safeInput}>Check Safe</button>
        </section>
      )}

      {checked && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>3. Names</h3>
          <p className="muted">Guardian (the other owner of this Safe): <span className="mono">{checked.guardian}</span></p>
          <label>Your name</label>
          <input placeholder="e.g. Dad" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          <label>Your guardian&apos;s name</label>
          <input placeholder="e.g. Mia" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />

          <p style={{ marginTop: 16 }}>
            <strong>Warning:</strong> changing or removing your guardian also needs your guardian&apos;s approval. This protects you if
            someone ever pressures you to turn protection off.
          </p>
          <label style={{ fontWeight: 400 }}>
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />
            I understand how this works
          </label>
          <button onClick={save} disabled={!understood || !!busy}>Save and continue</button>
        </section>
      )}

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
