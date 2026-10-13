import { promises as fs } from "fs";
import path from "path";
import { createPublicClient, erc20Abi, formatEther, formatUnits, getAddress, http } from "viem";
import { sepolia } from "viem/chains";
import { TOKENS } from "@/lib/tokens";
import { ALLOWANCE_MODULE, USDC, allowanceAbi, safeModuleAbi } from "./chain";
import { liveAccount } from "./account";
import { Lumi } from "./lumi/lumi";
import { ClaudeModel } from "./lumi/model";
import { Store } from "./lumi/store";

const FILE = path.join(process.cwd(), ".data", "second-look.json");

type Holder = { store: Store; lumi: Lumi; loaded: Promise<void>; names: { owner: string; guardian: string } };
const g = globalThis as unknown as { __secondLook?: Holder };

/** One account per server (one family). Kept in memory and mirrored to .data/ so dev reloads don't lose it.
 *  Live when a Safe is set up at /setup (names come from there too); otherwise the demo. */
export function holder(): Holder {
  if (g.__secondLook) return g.__secondLook;
  const account = liveAccount();
  const names = { owner: account?.ownerName ?? "Dad", guardian: account?.guardianName ?? "Mia" };
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const model = key ? new ClaudeModel(key, process.env.LUMI_MODEL ?? "claude-sonnet-5-5") : null;
  let store!: Store;
  const lumi = new Lumi(model, names, () => store.now());
  store = new Store(lumi, names, Date.now, true, account ? "live" : "demo");
  const loaded = fs
    .readFile(FILE, "utf8")
    .then((t) => store.restore(JSON.parse(t)))
    .catch(() => undefined);
  g.__secondLook = { store, lumi, loaded, names };
  return g.__secondLook;
}

/** Lumi and the store share this object, so new names apply right away. */
export function renameAccount(owner: string, guardian: string) {
  Object.assign(holder().names, { owner, guardian });
}

/** After /setup changes the Safe: start a fresh account (the old requests belong to another Safe). */
export async function resetHolder() {
  g.__secondLook = undefined;
  await fs.rm(FILE, { force: true });
}

export async function getStore(): Promise<Store> {
  const h = holder();
  await h.loaded;
  return h.store;
}

export async function save() {
  const h = holder();
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(h.store.snapshot()));
}

export function aiInfo() {
  const h = holder();
  return h.lumi.usingAI ? { model: process.env.LUMI_MODEL ?? "claude-sonnet-5-5" } : null;
}

// ---------- chain reads (live mode) ----------

const client = () => createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

export async function safeUsdcBalance(): Promise<number | undefined> {
  const account = liveAccount();
  if (!account) return undefined;
  try {
    const raw = await client().readContract({ address: USDC.address!, abi: erc20Abi, functionName: "balanceOf", args: [account.safeAddress] });
    return Number(formatUnits(raw, USDC.decimals));
  } catch {
    return undefined;
  }
}

/** The Safe's ETH balance (live mode). */
export async function safeEthBalance(): Promise<number | undefined> {
  const account = liveAccount();
  if (!account) return undefined;
  try {
    return Number(formatEther(await client().getBalance({ address: account.safeAddress })));
  } catch {
    return undefined;
  }
}

/** The Safe's other ERC-20 balances (any token added to lib/tokens.ts besides USDC) (EURC, LINK, …), by symbol. One failed read just leaves that token out. */
export async function safeTokenBalances(): Promise<Record<string, number> | undefined> {
  const account = liveAccount();
  if (!account) return undefined;
  const c = client();
  const out: Record<string, number> = {};
  await Promise.all(
    TOKENS.filter((t) => t.address && t.symbol !== "USDC").map(async (t) => {
      try {
        const raw = await c.readContract({ address: t.address!, abi: erc20Abi, functionName: "balanceOf", args: [account.safeAddress] });
        out[t.symbol] = Number(formatUnits(raw, t.decimals));
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export interface AllowanceInfo {
  enabled: boolean;
  limit: number;
  spent: number;
  remaining: number;
}

/** The owner's on-chain daily allowance, or `enabled: false` if the Safe hasn't turned it on. */
export async function ownerAllowance(owner?: string): Promise<AllowanceInfo> {
  const off = { enabled: false, limit: 0, spent: 0, remaining: 0 };
  const account = liveAccount();
  if (!account || !owner) return off;
  const safe = account.safeAddress;
  try {
    const c = client();
    const on = await c.readContract({ address: safe, abi: safeModuleAbi, functionName: "isModuleEnabled", args: [ALLOWANCE_MODULE] });
    if (!on) return off;
    const [amount, spent, resetTimeMin, lastResetMin] = await c.readContract({
      address: ALLOWANCE_MODULE,
      abi: allowanceAbi,
      functionName: "getTokenAllowance",
      args: [safe, getAddress(owner), USDC.address!],
    });
    if (amount === BigInt(0)) return off;
    const limit = Number(formatUnits(amount, USDC.decimals));
    // The module resets lazily on the next transfer; mirror that here so "remaining" is honest.
    const nowMin = BigInt(Math.floor(Date.now() / 60000));
    const reset = resetTimeMin > BigInt(0) && lastResetMin + resetTimeMin <= nowMin;
    const used = reset ? 0 : Number(formatUnits(spent, USDC.decimals));
    return { enabled: true, limit, spent: used, remaining: Math.max(0, limit - used) };
  } catch {
    return off;
  }
}
