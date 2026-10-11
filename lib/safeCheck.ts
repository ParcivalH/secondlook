// Server-only: check that a Safe can be protected by SecondLook (2-of-2, and `owner` is one of the two).
import SafeApiKit from "@safe-global/api-kit";
import { getAddress, isAddress } from "viem";
import { CHAIN_ID } from "./config";

export const apiKit = () => new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: process.env.SAFE_API_KEY });

export async function checkGuardedSafe(safeAddress: string, owner: string) {
  if (!isAddress(safeAddress) || !isAddress(owner)) throw new Error("Invalid address");
  let info;
  try {
    info = await apiKit().getSafeInfo(getAddress(safeAddress));
  } catch {
    throw new Error("This is not a Safe on Sepolia (or it is not activated yet)");
  }
  const owners = info.owners.map((o) => getAddress(o));
  const me = getAddress(owner);
  if (!owners.includes(me)) throw new Error("Your wallet is not an owner of this Safe");
  if (owners.length !== 2 || info.threshold !== 2) {
    throw new Error(`SecondLook needs a 2-of-2 Safe; this one is ${info.threshold}-of-${owners.length}`);
  }
  return { safeAddress: getAddress(safeAddress), owner: me, guardian: owners.find((o) => o !== me)! };
}
