import { isAddress } from "viem";
import { assessRisk } from "@/lib/risk";
import { findToken } from "@/lib/tokens";
import { hasSentTo } from "@/lib/store";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const token = findToken(b?.token);
  if (!token || !isAddress(b?.recipient ?? "") || !/^\d+(\.\d+)?$/.test(b?.amount ?? "")) {
    return Response.json({ error: "Invalid recipient, amount or token" }, { status: 400 });
  }
  const risk = assessRisk({
    token,
    amount: b.amount,
    firstTimeAddress: !(await hasSentTo(b.recipient)),
    addressPasted: Boolean(b.addressPasted),
    amountEdits: Number(b.amountEdits) || 0,
    hour: Number(b.hour) || 0,
  });
  return Response.json(risk);
}