import { getAddress, isAddress } from "viem";
import { EXPIRY_MS } from "@/lib/config";
import { findToken } from "@/lib/tokens";
import { buildTransfer } from "@/lib/buildTransfer";
import { safeTxHashes } from "@/lib/safeHash";
import { apiKit, checkGuardedSafe } from "@/lib/safeCheck";
import { getTransfer, saveTransfer } from "@/lib/store";

const cleanName = (s: unknown, fallback: string) => (typeof s === "string" && s.trim() ? s.trim().slice(0, 40) : fallback);

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const token = findToken(b?.token);
  if (!token || !isAddress(b?.recipient ?? "") || !isAddress(b?.senderAddress ?? "") || !b?.safeTransactionData || !b?.senderSignature) {
    return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  // 0. The Safe comes from the user, so check it on every request: 2-of-2 and the sender is an owner
  let safe;
  try {
    safe = await checkGuardedSafe(b.safeAddress, b.senderAddress);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid Safe" }, { status: 400 });
  }
  const tx = b.safeTransactionData;

  // 1. The signed transaction must be exactly what the owner typed (recipient, amount, token)
  const expected = buildTransfer(token, b.recipient, b.amount);
  if (getAddress(tx.to) !== getAddress(expected.to) || String(tx.value) !== expected.value || tx.data !== expected.data || tx.operation !== 0) {
    return Response.json({ error: "Signed transaction does not match the transfer details" }, { status: 400 });
  }
  // 2. Recompute the safeTxHash ourselves instead of trusting the browser
  const { safeTxHash } = safeTxHashes(safe.safeAddress, tx);
  if (safeTxHash.toLowerCase() !== String(b.safeTxHash).toLowerCase()) {
    return Response.json({ error: "safeTxHash mismatch" }, { status: 400 });
  }

  try {
    await apiKit().proposeTransaction({
      safeAddress: safe.safeAddress,
      safeTransactionData: tx,
      safeTxHash,
      senderAddress: safe.owner,
      senderSignature: b.senderSignature,
      origin: "SecondLook",
    });
  } catch (err) {
    console.error("[transfers] propose failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Propose failed" }, { status: 502 });
  }

  const now = Date.now();
  await saveTransfer({
    safeTxHash,
    safeAddress: safe.safeAddress,
    owner: safe.owner,
    ownerName: cleanName(b.ownerName, "Owner"),
    guardian: safe.guardian,
    guardianName: cleanName(b.guardianName, "Guardian"),
    recipient: getAddress(b.recipient),
    amount: b.amount,
    token: token.symbol,
    risk: b.risk,
    createdAt: now,
    expiresAt: now + EXPIRY_MS,
  });
  return Response.json({ safeTxHash });
}

export async function GET(req: Request) {
  const safeTxHash = new URL(req.url).searchParams.get("safeTxHash");
  if (!safeTxHash) return Response.json({ error: "safeTxHash required" }, { status: 400 });
  const record = await getTransfer(safeTxHash);
  if (!record) return Response.json({ error: "Unknown transfer" }, { status: 404 });

  try {
    const tx = await apiKit().getTransaction(safeTxHash);
    const confirmedBy = (tx.confirmations ?? []).map((c) => c.owner);
    const status = tx.isExecuted
      ? "executed"
      : record.cancelled
        ? "cancelled"
        : Date.now() > record.expiresAt
          ? "expired"
          : confirmedBy.length >= tx.confirmationsRequired
            ? "ready"
            : "waiting";
    return Response.json({
      record,
      status,
      confirmations: confirmedBy.length,
      threshold: tx.confirmationsRequired,
      confirmedBy,
      executionTxHash: tx.transactionHash,
      hoursLeft: Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 3_600_000)),
      tx, // raw Safe tx, needed by the browser to execute
    });
  } catch (err) {
    console.error("[transfers] status failed", err);
    return Response.json({ error: "Could not read the transfer from Safe" }, { status: 502 });
  }
}