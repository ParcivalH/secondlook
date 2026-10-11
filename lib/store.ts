// Tiny JSON-file store for transfers, so the owner and guardian sides share the same context.
// Server-only. Good enough for a single-machine demo.
import { promises as fs } from "fs";
import path from "path";
import type { RiskResult } from "./risk";

export type TransferRecord = {
  safeTxHash: string;
  safeAddress: string;
  owner: string;
  ownerName: string;
  guardian: string;
  guardianName: string;
  recipient: string;
  amount: string;
  token: string;
  risk: RiskResult;
  createdAt: number;
  expiresAt: number;
  cancelled?: boolean;
  rejected?: boolean;
  rejection?: { message: string; signature: string }; // guardian's Ledger-signed rejection
  executionTxHash?: string;
};

const FILE = path.join(process.cwd(), ".data", "transfers.json");

async function readAll(): Promise<Record<string, TransferRecord>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeAll(all: Record<string, TransferRecord>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}

export async function saveTransfer(r: TransferRecord) {
  const all = await readAll();
  all[r.safeTxHash] = r;
  await writeAll(all);
}

export async function getTransfer(safeTxHash: string) {
  return (await readAll())[safeTxHash];
}

export async function listTransfers() {
  return Object.values(await readAll()).sort((a, b) => b.createdAt - a.createdAt);
}

// Has this Safe sent to this recipient before?
export async function hasSentTo(safeAddress: string, recipient: string) {
  return (await listTransfers()).some(
    (t) => t.safeAddress.toLowerCase() === safeAddress.toLowerCase() && t.recipient.toLowerCase() === recipient.toLowerCase(),
  );
}
