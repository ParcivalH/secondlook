// Owner cancels a pending transfer ("You stopped it yourself").
// Note: this is app-level. On-chain the Safe tx simply never gets the guardian's signature.
import { getTransfer, saveTransfer } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const record = b?.safeTxHash ? await getTransfer(b.safeTxHash) : undefined;
  if (!record) return Response.json({ error: "Unknown transfer" }, { status: 404 });
  await saveTransfer({ ...record, cancelled: true });
  return Response.json({ ok: true });
}
