import { promises as fs } from "fs";
import path from "path";
import type { RiskResult } from "./risk";

export type TransferRecord = {
  safeTxHash: string;
  owner: string;
  recipient: string;
  amount: string;
  token: string;
  risk: RiskResult;
  createdAt: number;
  expiresAt: number;
  cancelled?: boolean;
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

export async function hasSentTo(recipient: string) {
  return (await listTransfers()).some((t) => t.recipient.toLowerCase() === recipient.toLowerCase());
}