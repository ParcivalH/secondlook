// Agent risk check (server). Rules-based for now; later the AI agent is called from here.
import { isAddress } from "viem";
import { assessRisk } from "@/lib/risk";
import { findToken } from "@/lib/tokens";
import { hasSentTo } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const token = findToken(b?.token);
  if (!token || !isAddress(b?.recipient ?? "") || !isAddress(b?.safeAddress ?? "") || !/^\d+(\.\d+)?$/.test(b?.amount ?? "")) {
    return Response.json({ error: "Invalid recipient, amount, token or Safe" }, { status: 400 });
  }
  const risk = assessRisk({
    token,
    amount: b.amount,
    firstTimeAddress: !(await hasSentTo(b.safeAddress, b.recipient)),
    addressPasted: Boolean(b.addressPasted),
    amountEdits: Number(b.amountEdits) || 0,
    hour: Number(b.hour) || 0,
  });
  return Response.json(risk);
}
