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