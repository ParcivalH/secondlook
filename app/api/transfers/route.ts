import SafeApiKit from "@safe-global/api-kit";
import { getAddress, isAddress } from "viem";
import { CHAIN_ID, EXPIRY_MS, SAFE_ADDRESS } from "@/lib/config";
import { findToken } from "@/lib/tokens";
import { buildTransfer } from "@/lib/buildTransfer";
import { safeTxHashes } from "@/lib/safeHash";
import { getTransfer, saveTransfer } from "@/lib/store";

const apiKit = () => new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: process.env.SAFE_API_KEY });

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const token = findToken(b?.token);
  if (!token || !isAddress(b?.recipient ?? "") || !isAddress(b?.senderAddress ?? "") || !b?.safeTransactionData || !b?.senderSignature) {
    return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
  }
  const tx = b.safeTransactionData;

  const expected = buildTransfer(token, b.recipient, b.amount);
  if (getAddress(tx.to) !== getAddress(expected.to) || String(tx.value) !== expected.value || tx.data !== expected.data || tx.operation !== 0) {
    return Response.json({ error: "Signed transaction does not match the transfer details" }, { status: 400 });
  }
  const { safeTxHash } = safeTxHashes(SAFE_ADDRESS, tx);
  if (safeTxHash.toLowerCase() !== String(b.safeTxHash).toLowerCase()) {
    return Response.json({ error: "safeTxHash mismatch" }, { status: 400 });
  }

  try {
    await apiKit().proposeTransaction({
      safeAddress: SAFE_ADDRESS,
      safeTransactionData: tx,
      safeTxHash,
      senderAddress: getAddress(b.senderAddress),
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
    owner: getAddress(b.senderAddress),
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