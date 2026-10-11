// GET  /api/guardian -> the Guardian's Ledger address + transfers waiting for this Guardian
// POST /api/guardian {action: "approve" | "reject", safeTxHash} -> wakes the Ledger to sign
import { getAddress } from "viem";
import { ledgerAddress, ledgerError } from "@/lib/ledger";
import { approveAndExecute, rejectOnLedger } from "@/lib/guardian";
import { apiKit } from "@/lib/safeCheck";
import { listTransfers } from "@/lib/store";

export async function GET() {
  let guardian: string;
  try {
    guardian = await ledgerAddress();
  } catch (err) {
    return Response.json({ error: ledgerError(err) }, { status: 503 });
  }

  const now = Date.now();
  const mine = (await listTransfers()).filter(
    (t) => getAddress(t.guardian) === guardian && !t.cancelled && !t.rejected && !t.executionTxHash && now < t.expiresAt,
  );
  // Drop the ones already executed some other way (e.g. in the Safe app)
  const pending = [];
  for (const t of mine) {
    try {
      const tx = await apiKit().getTransaction(t.safeTxHash);
      if (!tx.isExecuted) pending.push({ ...t, hoursLeft: Math.ceil((t.expiresAt - now) / 3_600_000) });
    } catch {
      pending.push({ ...t, hoursLeft: Math.ceil((t.expiresAt - now) / 3_600_000) });
    }
  }
  return Response.json({ guardian, pending });
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b?.safeTxHash || !["approve", "reject"].includes(b?.action)) {
    return Response.json({ error: "action and safeTxHash required" }, { status: 400 });
  }
  try {
    const out = b.action === "approve" ? await approveAndExecute(b.safeTxHash) : await rejectOnLedger(b.safeTxHash);
    return Response.json(out);
  } catch (err) {
    console.error("[guardian]", err);
    const e = err as { shortMessage?: string };
    return Response.json({ error: e.shortMessage || ledgerError(err) }, { status: 400 });
  }
}
