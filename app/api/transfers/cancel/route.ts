import { getTransfer, saveTransfer } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const record = b?.safeTxHash ? await getTransfer(b.safeTxHash) : undefined;
  if (!record) return Response.json({ error: "Unknown transfer" }, { status: 404 });
  await saveTransfer({ ...record, cancelled: true });
  return Response.json({ ok: true });
}