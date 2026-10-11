// Guardian side, in the browser: Mia's Ledger over USB (WebHID) or the Speculos emulator,
// through Ledger's Device Management Kit. Signs the SafeTx as EIP-712 typed data.
import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  UserInteractionRequired,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { SignerEthBuilder, type SignerEth, type TypedData } from "@ledgerhq/device-signer-kit-ethereum";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, type Observable } from "rxjs";
import { decodeFunctionData, erc20Abi, formatUnits, getAddress } from "viem";
import { CHAIN_ID } from "@/lib/config";
import { safeTxHashes, type SafeTxFields } from "@/lib/safeHash";
import { USDC, ALLOWANCE_MODULE, allowanceAbi } from "./chain";

export const GUARDIAN_PATH = "44'/60'/0'/0/0";

export type LedgerTransport = { kind: "webhid" } | { kind: "speculos"; url: string };

export function configuredTransport(): LedgerTransport {
  // Speculos's REST API has no CORS headers, so the browser reaches it through the /speculos rewrite in next.config.ts.
  return process.env.NEXT_PUBLIC_LEDGER_TRANSPORT === "speculos" ? { kind: "speculos", url: "/speculos" } : { kind: "webhid" };
}

const PROMPTS: Partial<Record<UserInteractionRequired, string>> = {
  [UserInteractionRequired.UnlockDevice]: "Unlock your Ledger with your PIN",
  [UserInteractionRequired.ConfirmOpenApp]: "Open the Ethereum app on your Ledger",
  [UserInteractionRequired.AllowSecureConnection]: "Allow the connection on your Ledger",
  [UserInteractionRequired.Web3ChecksOptIn]: "Choose whether to turn on transaction checks",
  [UserInteractionRequired.SignTypedData]: "Check every line on your Ledger, then hold both buttons to sign",
  [UserInteractionRequired.VerifyAddress]: "Check the address on your Ledger matches",
};

type State<O> =
  | { status: DeviceActionStatus.NotStarted }
  | { status: DeviceActionStatus.Pending; intermediateValue: { requiredUserInteraction: string } }
  | { status: DeviceActionStatus.Stopped }
  | { status: DeviceActionStatus.Completed; output: O }
  | { status: DeviceActionStatus.Error; error: unknown };

function run<O>(obs: Observable<State<O>>, onStatus?: (m: string) => void): Promise<O> {
  return new Promise((resolve, reject) => {
    const sub = obs.subscribe({
      next: (s) => {
        if (s.status === DeviceActionStatus.Pending) {
          const m = PROMPTS[s.intermediateValue.requiredUserInteraction as UserInteractionRequired];
          if (m) onStatus?.(m);
        } else if (s.status === DeviceActionStatus.Completed) {
          sub.unsubscribe();
          resolve(s.output);
        } else if (s.status === DeviceActionStatus.Error) {
          sub.unsubscribe();
          const e = s.error as { message?: string; _tag?: string };
          reject(new Error(e?.message ?? e?._tag ?? "The Ledger reported an error"));
        } else if (s.status === DeviceActionStatus.Stopped) {
          sub.unsubscribe();
          reject(new Error("Cancelled on the device"));
        }
      },
      error: (e) => reject(e instanceof Error ? e : new Error(String(e))),
    });
  });
}

export class GuardianLedger {
  private dmk: DeviceManagementKit;
  private sessionId: DeviceSessionId | null = null;
  private signer: SignerEth | null = null;

  constructor(readonly transport: LedgerTransport = configuredTransport()) {
    const factory = transport.kind === "speculos" ? speculosTransportFactory(transport.url) : webHidTransportFactory;
    this.dmk = new DeviceManagementKitBuilder().addTransport(factory).build();
  }

  static supported(t: LedgerTransport = configuredTransport()) {
    return t.kind === "speculos" || (typeof navigator !== "undefined" && "hid" in navigator);
  }

  get connected() {
    return this.signer !== null;
  }

  async connect() {
    const device = await firstValueFrom(this.dmk.startDiscovering({}));
    this.sessionId = await this.dmk.connect({ device });
    this.signer = new SignerEthBuilder({ dmk: this.dmk, sessionId: this.sessionId }).build();
  }

  private need() {
    if (!this.signer) throw new Error("Connect your Ledger first");
    return this.signer;
  }

  async getAddress(onStatus?: (m: string) => void): Promise<`0x${string}`> {
    const { observable } = this.need().getAddress(GUARDIAN_PATH, { checkOnDevice: false, chainId: CHAIN_ID });
    const out = await run(observable as Observable<State<{ address: `0x${string}` }>>, onStatus);
    return getAddress(out.address);
  }

  async signTypedData(typed: TypedData, onStatus?: (m: string) => void) {
    const { observable } = this.need().signTypedData(GUARDIAN_PATH, typed);
    return run(observable as Observable<State<{ r: string; s: string; v: number }>>, onStatus);
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** The SafeTx as EIP-712 typed data for the Ledger. Refuses if it doesn't hash to what Dad signed. */
export function safeTxTypedData(safeAddress: string, tx: SafeTxFields, expectedHash: string): TypedData {
  if (safeTxHashes(safeAddress, tx).safeTxHash.toLowerCase() !== expectedHash.toLowerCase())
    throw new Error("This request doesn't match what was signed. Don't sign it.");
  return {
    domain: { chainId: CHAIN_ID, verifyingContract: safeAddress },
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: tx.to,
      value: String(tx.value),
      data: tx.data || "0x",
      operation: tx.operation,
      safeTxGas: String(tx.safeTxGas),
      baseGas: String(tx.baseGas),
      gasPrice: String(tx.gasPrice),
      gasToken: tx.gasToken || ZERO,
      refundReceiver: tx.refundReceiver || ZERO,
      nonce: String(tx.nonce),
    },
  };
}

/** 65-byte r‖s‖v with v as 27/28, the Safe's EIP-712 signature format. */
export function packSignature(sig: { r: string; s: string; v: number }): `0x${string}` {
  const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
  const v = sig.v < 27 ? sig.v + 27 : sig.v;
  return `0x${strip(sig.r).padStart(64, "0")}${strip(sig.s).padStart(64, "0")}${v.toString(16).padStart(2, "0")}`;
}

/** What Mia should expect on her screen, decoded from the raw call. */
export function describeSafeTx(tx: SafeTxFields): string {
  const data = (tx.data || "0x") as `0x${string}`;
  if (Number(tx.operation) === 1) return "Setup batch: turn on the daily allowance";
  try {
    if (getAddress(tx.to) === getAddress(USDC.address!)) {
      const d = decodeFunctionData({ abi: erc20Abi, data });
      if (d.functionName === "transfer") return `USDC transfer of ${formatUnits(d.args[1], USDC.decimals)} to ${d.args[0]}`;
    }
    if (getAddress(tx.to) === getAddress(ALLOWANCE_MODULE)) {
      const d = decodeFunctionData({ abi: allowanceAbi, data });
      if (d.functionName === "setAllowance") return `Daily allowance set to ${formatUnits(d.args[2], USDC.decimals)} USDC`;
    }
  } catch {
    /* fall through */
  }
  return `Call to ${tx.to}`;
}
