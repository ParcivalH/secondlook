// Server-only: which Safe this server protects, and the two people on it.
// Set from /setup (validated as a 2-of-2 Safe), saved in .data/ so Dad's phone and Mia's laptop see the same account.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { HttpError } from "./lumi/store";

export type Account = {
  safeAddress: `0x${string}`;
  ownerAddress: `0x${string}`; // MetaMask (software wallet)
  ownerName: string;
  guardianAddress: `0x${string}`; // Ledger
  guardianName: string;
};

const FILE = path.join(process.cwd(), ".data", "second-look-account.json");

export function getAccount(): Account | null {
  try {
    return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Account) : null;
  } catch {
    return null;
  }
}

export function saveAccount(a: Account) {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(a, null, 2));
}

export function clearAccount() {
  rmSync(FILE, { force: true });
}

/** Live = a Safe is set up (and demo mode isn't forced). Otherwise the app runs the simulated demo. */
export function liveAccount(): Account | null {
  if (process.env.NEXT_PUBLIC_SECOND_LOOK_MODE === "demo") return null;
  return getAccount();
}

export function requireLive(): Account {
  const a = liveAccount();
  if (!a) throw new HttpError(400, "Not in live mode: set up your Safe at /setup first");
  return a;
}
