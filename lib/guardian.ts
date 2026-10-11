// Server-only: the Guardian's actions on a pending transfer, done with the Guardian's Ledger.
// Same logic as scripts/4-guardian-approve-and-execute.cjs, as functions the website can call.
import { createPublicClient, encodeFunctionData, getAddress, http, pad, concat, keccak256, toHex, serializeTransaction, verifyMessage, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { safeTxHashes } from "./safeHash";
import { apiKit } from "./safeCheck";
import { getTransfer, saveTransfer } from "./store";
import type Eth from "@ledgerhq/hw-app-eth";
import { LEDGER_PATH, withLedger } from "./ledger";

const client = () => createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

const SAFE_EXEC_ABI = [
  {
    type: "function", name: "execTransaction", stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;
const EXECUTION_SUCCESS = keccak256(toHex("ExecutionSuccess(bytes32,uint256)"));
const ZERO = "0x0000000000000000000000000000000000000000";

// Check the Safe transaction in the Safe queue: not executed, exactly the owner's signature, and the hash matches
export async function checkSafeTx(safeAddress: string, safeTxHash: string, owner: string) {
  const tx = await apiKit().getTransaction(safeTxHash);
  if (tx.isExecuted) throw new Error("Already executed");
  const owners = tx.confirmations ?? [];
  if (owners.length !== 1 || getAddress(owners[0].owner) !== getAddress(owner)) {
    throw new Error("Expected exactly the owner's signature (1 of 2)");
  }
  // Never trust the server: recompute the hash from the fields
  if (safeTxHashes(safeAddress, { ...tx, data: tx.data ?? null }).safeTxHash.toLowerCase() !== safeTxHash.toLowerCase()) {
    throw new Error("Hash mismatch. Do NOT sign.");
  }
  return { tx, ownerSignature: owners[0].signature as Hex };
}

// Load a transfer saved by /api/transfers and check it is still waiting for the Guardian
async function loadRecord(safeTxHash: string) {
  const record = await getTransfer(safeTxHash);
  if (!record) throw new Error("Unknown transfer");
  if (record.cancelled) throw new Error("The owner cancelled this transfer");
  if (record.rejected) throw new Error("Already rejected");
  if (Date.now() > record.expiresAt) throw new Error("This transfer expired");
  return record;
}

const ledgerSigner = async (eth: Eth, expected: string) => {
  const guardian = getAddress((await eth.getAddress(LEDGER_PATH)).address);
  if (guardian !== getAddress(expected)) throw new Error(`This Ledger (${guardian}) is not the guardian ${getAddress(expected)}`);
  return guardian;
};

// Approve = execute: the Ledger signs ONE Ethereum tx calling execTransaction on the Safe,
// with the owner's EIP-712 signature + the Guardian's pre-validated signature (msg.sender).
// onSent runs as soon as the tx is broadcast (before it is mined), so callers can save the hash.
export async function executeOnLedger(p: { safeAddress: string; safeTxHash: string; owner: string; guardian: string; onSent?: (hash: Hex) => Promise<void> }) {
  return withLedger(async (eth) => {
    const guardian = await ledgerSigner(eth, p.guardian);
    const { tx, ownerSignature } = await checkSafeTx(p.safeAddress, p.safeTxHash, p.owner);
    const safe = getAddress(p.safeAddress);
    const guardianSignature = concat([pad(guardian, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);

    const parts = [
      { owner: getAddress(p.owner), sig: ownerSignature },
      { owner: guardian, sig: guardianSignature },
    ].sort((a, b) => (BigInt(a.owner) < BigInt(b.owner) ? -1 : 1));

    const data = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      functionName: "execTransaction",
      args: [
        getAddress(tx.to), BigInt(tx.value), (tx.data || "0x") as Hex, tx.operation,
        BigInt(tx.safeTxGas), BigInt(tx.baseGas), BigInt(tx.gasPrice),
        getAddress(tx.gasToken || ZERO), getAddress(tx.refundReceiver || ZERO), concat(parts.map((x) => x.sig)),
      ],
    });

    const c = client();
    const gas = await c.estimateGas({ account: guardian, to: safe, data }); // dry run before asking the Ledger
    const fees = await c.estimateFeesPerGas();
    const unsigned = {
      type: "eip1559" as const, chainId: sepolia.id, to: safe, value: BigInt(0), data,
      nonce: await c.getTransactionCount({ address: guardian, blockTag: "pending" }),
      gas: (gas * BigInt(12)) / BigInt(10),
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };

    const sig = await eth.signTransaction(LEDGER_PATH, serializeTransaction(unsigned).slice(2), null);
    const v = parseInt(sig.v, 16);
    const signed = serializeTransaction(unsigned, { r: `0x${sig.r}`, s: `0x${sig.s}`, yParity: v >= 27 ? v - 27 : v });

    const hash = await c.sendRawTransaction({ serializedTransaction: signed });
    await p.onSent?.(hash);
    const receipt = await c.waitForTransactionReceipt({ hash });
    const ok = receipt.status === "success" && receipt.logs.some((l) => getAddress(l.address) === safe && l.topics[0] === EXECUTION_SUCCESS);
    if (!ok) throw new Error(`Transaction mined but the Safe transfer failed: ${hash}`);
    return { guardian, guardianSignature, executionTxHash: hash };
  });
}

// The Guardian signs a plain-text message on the Ledger (shown on the device screen).
export async function signMessageOnLedger(message: string, expectedGuardian: string) {
  return withLedger(async (eth) => {
    const guardian = await ledgerSigner(eth, expectedGuardian);
    const sig = await eth.signPersonalMessage(LEDGER_PATH, Buffer.from(message).toString("hex"));
    const signature = `0x${sig.r}${sig.s}${sig.v.toString(16)}` as Hex;
    if (!(await verifyMessage({ address: guardian, message, signature }))) throw new Error("Signature check failed");
    return { guardian, message, signature };
  });
}

// /guardian page: approve a transfer from /api/transfers
export async function approveAndExecute(safeTxHash: string) {
  const record = await loadRecord(safeTxHash);
  const { executionTxHash } = await executeOnLedger({
    safeAddress: record.safeAddress, safeTxHash, owner: record.owner, guardian: record.guardian,
    onSent: (hash) => saveTransfer({ ...record, executionTxHash: hash }),
  });
  return { executionTxHash };
}

// /guardian page, Reject: nothing moves on-chain; the transfer simply never gets the second signature.
export async function rejectOnLedger(safeTxHash: string) {
  const record = await loadRecord(safeTxHash);
  await checkSafeTx(record.safeAddress, safeTxHash, record.owner);
  const { message, signature } = await signMessageOnLedger(
    `SecondLook: REJECT ${record.amount} ${record.token} to ${record.recipient}. Ref ${safeTxHash.slice(0, 10)}`,
    record.guardian,
  );
  await saveTransfer({ ...record, rejected: true, rejection: { message, signature } });
  return { rejected: true };
}
