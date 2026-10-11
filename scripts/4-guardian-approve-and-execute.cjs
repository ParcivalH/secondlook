// Guardian flow, one tap: Mia reviews the pending transfer, then her Ledger signs ONE Ethereum
// transaction that executes it on the Safe. No extra "Send now" step for the owner.
//
// How: Safe accepts a "pre-validated" signature from an owner who is also the sender of the
// execTransaction call (msg.sender). So the Guardian's approval IS the execution transaction.
// The owner's EIP-712 signature (made in MetaMask) comes from the Safe Transaction Service.
const fs = require("fs");
const path = require("path");
const Eth = require("@ledgerhq/hw-app-eth").default;
const SpeculosHttpTransport = require("@ledgerhq/hw-transport-node-speculos-http").default;
const SafeApiKit = require("@safe-global/api-kit").default;
const {
  createPublicClient, http, getAddress, formatEther, formatUnits, decodeFunctionData, erc20Abi,
  encodeFunctionData, serializeTransaction, pad, concat, keccak256, toHex,
  hashDomain, hashStruct,
} = require("viem");
const { sepolia } = require("viem/chains");

const PATH = "44'/60'/0'/0/0";
const CHAIN_ID = 11155111;
const ZERO = "0x0000000000000000000000000000000000000000";
const { SAFE_ADDRESS, SAFE_API_KEY, SEPOLIA_RPC_URL } = process.env;

const KNOWN_TOKENS = {
  "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": { symbol: "USDC", decimals: 6 },
};

const SAFE_ABI = [
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
];
const EXECUTION_SUCCESS = keccak256(toHex("ExecutionSuccess(bytes32,uint256)"));

const DOMAIN_TYPES = { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] };
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

function describe(tx) {
  const data = tx.data || "0x";
  if (data === "0x") return { kind: "ETH transfer", recipient: tx.to, amount: `${formatEther(BigInt(tx.value))} ETH` };
  const token = KNOWN_TOKENS[tx.to.toLowerCase()];
  if (token && BigInt(tx.value) === BigInt(0)) {
    try {
      const call = decodeFunctionData({ abi: erc20Abi, data });
      if (call.functionName === "transfer") {
        return { kind: `${token.symbol} transfer`, recipient: call.args[0], amount: `${formatUnits(call.args[1], token.decimals)} ${token.symbol}` };
      }
    } catch {}
  }
  return { kind: "UNKNOWN contract call -- review carefully", recipient: tx.to, amount: `${formatEther(BigInt(tx.value))} ETH + data` };
}

// Safe wants signatures concatenated, sorted by owner address (ascending).
// Pre-validated signature for msg.sender: r = owner address (32 bytes), s = 0, v = 1.
function buildSignatures(ownerConfirmations, guardian) {
  const parts = ownerConfirmations.map((c) => ({ owner: getAddress(c.owner), sig: c.signature }));
  parts.push({ owner: guardian, sig: concat([pad(guardian, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]) });
  parts.sort((a, b) => (BigInt(a.owner) < BigInt(b.owner) ? -1 : 1));
  return concat(parts.map((p) => p.sig));
}

// Refuse transfers the owner cancelled or that expired (24h) in the SecondLook app
function appStatus(safeTxHash) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".data", "transfers.json"), "utf8"));
    const r = all[safeTxHash];
    if (!r) return "unknown";
    if (r.cancelled) return "cancelled";
    if (Date.now() > r.expiresAt) return "expired";
    return "active";
  } catch {
    return "unknown";
  }
}

async function main() {
  // 1. Guardian's Ledger
  const transport = await SpeculosHttpTransport.open({ baseURL: "http://127.0.0.1", apiPort: "5001" });
  const eth = new Eth(transport);
  const guardian = getAddress((await eth.getAddress(PATH)).address);
  const client = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
  console.log("Guardian Ledger:", guardian, `(gas balance ${formatEther(await client.getBalance({ address: guardian }))} ETH)`);

  // 2. Pending transfer (by safeTxHash argument, or lowest nonce)
  const apiKit = new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: SAFE_API_KEY });
  const pending = (await apiKit.getPendingTransactions(SAFE_ADDRESS)).results;
  const wanted = process.argv[2];
  const tx = wanted
    ? pending.find((t) => t.safeTxHash.toLowerCase() === wanted.toLowerCase())
    : pending.sort((a, b) => Number(a.nonce) - Number(b.nonce))[0];
  if (!tx) throw new Error("No pending transaction");

  const status = appStatus(tx.safeTxHash);
  if (status === "cancelled" || status === "expired") throw new Error(`This transfer was ${status} in SecondLook. Not executing.`);

  const what = describe(tx);
  const owners = tx.confirmations || [];
  console.log("------------------------------------------");
  console.log("Type:      ", what.kind);
  console.log("Recipient: ", what.recipient);
  console.log("Amount:    ", what.amount);
  console.log("Nonce:     ", tx.nonce);
  console.log("Signed by: ", owners.map((c) => c.owner).join(", ") || "nobody");
  console.log("------------------------------------------");
  if (owners.length !== 1 || tx.confirmationsRequired !== 2) throw new Error("Expected exactly the owner's signature, 1 of 2");
  if (getAddress(owners[0].owner) === guardian) throw new Error("The Guardian already signed this one");

  // 3. Never trust the server: recompute the safeTxHash from its fields
  const fields = {
    to: tx.to, value: BigInt(tx.value), data: tx.data || "0x", operation: tx.operation,
    safeTxGas: BigInt(tx.safeTxGas), baseGas: BigInt(tx.baseGas), gasPrice: BigInt(tx.gasPrice),
    gasToken: tx.gasToken || ZERO, refundReceiver: tx.refundReceiver || ZERO, nonce: BigInt(tx.nonce),
  };
  const domainSeparator = hashDomain({ domain: { chainId: BigInt(CHAIN_ID), verifyingContract: SAFE_ADDRESS }, types: DOMAIN_TYPES });
  const structHash = hashStruct({ primaryType: "SafeTx", types: SAFE_TX_TYPES, data: fields });
  const safeTxHash = keccak256(concat(["0x19", "0x01", domainSeparator, structHash]));
  if (safeTxHash.toLowerCase() !== tx.safeTxHash.toLowerCase()) throw new Error("Hash mismatch. Do NOT sign.");
  console.log("Verified safeTxHash:", safeTxHash);

  // 4. Build the execTransaction call: owner's signature + Guardian's pre-validated signature
  const data = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [fields.to, fields.value, fields.data, fields.operation, fields.safeTxGas, fields.baseGas,
      fields.gasPrice, fields.gasToken, fields.refundReceiver, buildSignatures(owners, guardian)],
  });

  // Dry run first: if the Safe would reject it, stop before asking the Ledger
  const gas = await client.estimateGas({ account: guardian, to: SAFE_ADDRESS, data });
  const fees = await client.estimateFeesPerGas();
  const unsigned = {
    type: "eip1559", chainId: CHAIN_ID, to: SAFE_ADDRESS, value: BigInt(0), data,
    nonce: await client.getTransactionCount({ address: guardian, blockTag: "pending" }),
    gas: (gas * BigInt(12)) / BigInt(10),
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };

  // 5. One tap on the Ledger: approve = execute
  console.log(">>> Guardian: approve on the Ledger emulator: http://localhost:5001");
  console.log("    (the device shows a contract call to the Safe", SAFE_ADDRESS + ")");
  const sig = await eth.signTransaction(PATH, serializeTransaction(unsigned).slice(2), null);
  const v = parseInt(sig.v, 16);
  const signedTx = serializeTransaction(unsigned, { r: `0x${sig.r}`, s: `0x${sig.s}`, yParity: v >= 27 ? v - 27 : v });
  await transport.close();

  const hash = await client.sendRawTransaction({ serializedTransaction: signedTx });
  console.log("Sent:", `https://sepolia.etherscan.io/tx/${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  const ok = receipt.status === "success" &&
    receipt.logs.some((l) => getAddress(l.address) === getAddress(SAFE_ADDRESS) && l.topics[0] === EXECUTION_SUCCESS);
  console.log(ok ? "Executed! Transfer sent." : "Transaction mined but the Safe transfer FAILED. Check Etherscan.");
}

main().catch((err) => {
  console.error("Error:", err.shortMessage || err.message);
  process.exit(1);
});