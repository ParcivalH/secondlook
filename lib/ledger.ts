// Server-only: talk to the Guardian's Ledger. Today it is the Speculos emulator over HTTP;
// for a real device, only `openTransport` changes (e.g. a USB transport).
import Eth from "@ledgerhq/hw-app-eth";
import SpeculosHttpTransport from "@ledgerhq/hw-transport-node-speculos-http";
import { getAddress } from "viem";

export const LEDGER_PATH = "44'/60'/0'/0/0";
const SPECULOS_PORT = process.env.SPECULOS_PORT || "5001";

let busy = false; // one device, one request at a time

export async function withLedger<T>(fn: (eth: Eth) => Promise<T>): Promise<T> {
  if (busy) throw new Error("The Ledger is busy with another request");
  busy = true;
  let transport: SpeculosHttpTransport | undefined;
  try {
    try {
      transport = await SpeculosHttpTransport.open({ baseURL: "http://127.0.0.1", apiPort: SPECULOS_PORT });
    } catch {
      throw new Error(`Cannot reach the Ledger emulator on port ${SPECULOS_PORT}. Is Speculos running?`);
    }
    return await fn(new Eth(transport));
  } finally {
    await transport?.close().catch(() => {});
    busy = false;
  }
}

export function ledgerAddress() {
  return withLedger(async (eth) => getAddress((await eth.getAddress(LEDGER_PATH)).address));
}

// Turn Ledger APDU status codes into something a person understands
export function ledgerError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("6985")) return "Rejected on the Ledger";
  if (msg.includes("6a80")) return "Blind signing is disabled on the Ledger (Settings > Blind signing)";
  return msg;
}
