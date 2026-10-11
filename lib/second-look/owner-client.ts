// Owner side, in the browser: Dad's MetaMask. Everyday transfers go through the Allowance Module;
// anything that needs Mia becomes a Safe transaction Dad signs first (EIP-712) and the server queues.
import { createWalletClient, custom, encodeFunctionData, getAddress, parseUnits, zeroAddress } from "viem";
import { sepolia } from "viem/chains";
import { buildTransfer } from "@/lib/buildTransfer";
import { connectOwnerWallet, openSafe } from "@/lib/wallet";
import { amountString, symOf, tokenOf } from "./assets";
import { ALLOWANCE_MODULE, DAILY_RESET_MIN, USDC, allowanceAbi, safeModuleAbi } from "./chain";

const units = (amount: number) => parseUnits(amount.toFixed(USDC.decimals), USDC.decimals);
const utcMidnightMin = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 60000);
};

/** The Safe and owner come from /setup (the server's /state), not from env. */
export type Live = { safe: string; owner: string };

/** MetaMask must be the owner wallet chosen in /setup. */
export async function ownerAddress(live: Live) {
  const me = await connectOwnerWallet();
  if (getAddress(me) !== getAddress(live.owner)) throw new Error(`Switch MetaMask to the owner account ${live.owner}`);
  return me;
}

/** Within today's allowance: Dad calls the module directly; with an empty signature it uses msg.sender as the delegate. */
export async function sendWithinAllowance(live: Live, to: string, amount: number): Promise<`0x${string}`> {
  const owner = await ownerAddress(live);
  const wallet = createWalletClient({ account: owner, chain: sepolia, transport: custom(window.ethereum!) });
  return wallet.writeContract({
    address: ALLOWANCE_MODULE,
    abi: allowanceAbi,
    functionName: "executeAllowanceTransfer",
    args: [getAddress(live.safe), USDC.address!, getAddress(to), units(amount), zeroAddress, BigInt(0), owner, "0x"],
  });
}

type Calls = { to: string; value: string; data: string }[];

/** The Safe calls a request needs, by kind. */
export async function callsFor(req: { kind: string; to?: string; amount?: number; token?: string; change?: { kind: string; limit?: number; to?: number } }, owner: string, safe: string): Promise<Calls | "removeGuardian"> {
  if (req.kind === "transfer") {
    const token = symOf(req);
    return [buildTransfer(tokenOf(token), req.to!, amountString(req.amount!, token))];
  }
  const c = req.change!;
  const setAllowance = (limit: number) => ({
    to: ALLOWANCE_MODULE,
    value: "0",
    data: encodeFunctionData({ abi: allowanceAbi, functionName: "setAllowance", args: [getAddress(owner), USDC.address!, units(limit), DAILY_RESET_MIN, utcMidnightMin()] }),
  });
  if (c.kind === "enableProtection")
    return [
      { to: getAddress(safe), value: "0", data: encodeFunctionData({ abi: safeModuleAbi, functionName: "enableModule", args: [ALLOWANCE_MODULE] }) },
      { to: ALLOWANCE_MODULE, value: "0", data: encodeFunctionData({ abi: allowanceAbi, functionName: "addDelegate", args: [getAddress(owner)] }) },
      setAllowance(c.limit!),
    ];
  if (c.kind === "limit") return [setAllowance(c.to!)];
  if (c.kind === "removeGuardian") return "removeGuardian";
  throw new Error("This change has no on-chain step");
}

/** Dad signs the Safe transaction in MetaMask (signature 1 of 2); the server checks it and queues it for Mia. */
export async function signAndPropose(live: Live, req: Parameters<typeof callsFor>[0] & { id: string }) {
  const owner = await ownerAddress(live);
  const kit = await openSafe(owner, live.safe);
  const calls = await callsFor(req, owner, live.safe);
  let safeTx;
  if (calls === "removeGuardian") {
    const guardian = (await kit.getOwners()).find((o) => getAddress(o) !== owner);
    if (!guardian) throw new Error("No guardian on this account");
    safeTx = await kit.createRemoveOwnerTx({ ownerAddress: guardian, threshold: 1 });
  } else {
    safeTx = await kit.createTransaction({ transactions: calls });
  }
  const safeTxHash = await kit.getTransactionHash(safeTx);
  const signed = await kit.signTransaction(safeTx, "eth_signTypedData_v4");
  const sig = signed.getSignature(owner);
  if (!sig) throw new Error("MetaMask did not return a signature");
  const res = await fetch(`/api/sl/requests/${req.id}/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ safeTransactionData: safeTx.data, safeTxHash, senderAddress: owner, senderSignature: sig.data }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? "Couldn't queue the transaction");
  return out;
}

/** WebHID path only: Mia signed in the browser, so Dad sends it (pays gas), then tells the server the transaction hash.
 *  (With the Speculos/server Ledger, Mia's approval already executes it.) */
export async function executeApproved(live: Live, id: string): Promise<string> {
  const owner = await ownerAddress(live);
  const kit = await openSafe(owner, live.safe);
  const res = await fetch(`/api/sl/requests/${id}/safe-tx`);
  const tx = await res.json();
  if (!res.ok) throw new Error(tx.error ?? "Couldn't load the Safe transaction");
  const result = await kit.executeTransaction(tx);
  await fetch(`/api/sl/requests/${id}/executed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: result.hash }) });
  return result.hash;
}
