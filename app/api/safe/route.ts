// GET /api/safe?owner=0x...            -> the Safes this wallet owns on Sepolia
// GET /api/safe?owner=0x...&safe=0x... -> check that Safe is a 2-of-2 the wallet co-owns; returns the guardian
import { getAddress, isAddress } from "viem";
import { apiKit, checkGuardedSafe } from "@/lib/safeCheck";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const owner = params.get("owner") ?? "";
  const safe = params.get("safe");
  if (!isAddress(owner)) return Response.json({ error: "owner address required" }, { status: 400 });

  try {
    if (safe) return Response.json(await checkGuardedSafe(safe, owner));
    const { safes } = await apiKit().getSafesByOwner(getAddress(owner));
    return Response.json({ safes });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Safe lookup failed" }, { status: 400 });
  }
}
