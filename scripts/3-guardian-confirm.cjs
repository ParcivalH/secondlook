const Eth = require("@ledgerhq/hw-app-eth").default;
const SpeculosHttpTransport = require("@ledgerhq/hw-transport-node-speculos-http").default;
const SafeApiKit = require("@safe-global/api-kit").default;
const { getAddress, formatEther, hashDomain, hashStruct, keccak256, concat, recoverAddress } = require("viem");

const PATH = "44'/60'/0'/0/0";
const CHAIN_ID = 11155111; 
const ZERO = "0x0000000000000000000000000000000000000000";
const { SAFE_ADDRESS, SAFE_API_KEY } = process.env;

const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};
const SAFE_TX_TYPES = {
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
};

async function main() {
  const transport = await SpeculosHttpTransport.open({ baseURL: "http://127.0.0.1", apiPort: "5001" });
  const eth = new Eth(transport);
  const guardian = getAddress((await eth.getAddress(PATH)).address);
  console.log("Guardian Ledger:", guardian);

  const apiKit = new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: SAFE_API_KEY });
  const pending = (await apiKit.getPendingTransactions(SAFE_ADDRESS)).results;

  const wanted = process.argv[2];
  const notSignedByGuardian = (t) => !(t.confirmations || []).some((c) => getAddress(c.owner) === guardian);
  const candidates = wanted
    ? pending.filter((t) => t.safeTxHash.toLowerCase() === wanted.toLowerCase())
    : pending.filter(notSignedByGuardian).sort((a, b) => Number(a.nonce) - Number(b.nonce));
  const tx = candidates[0];
  if (!tx) throw new Error("No pending transaction waiting for the Guardian");

  console.log("------------------------------------------");
  console.log("To:        ", tx.to);
  console.log("Amount:    ", formatEther(BigInt(tx.value)), "ETH");
  console.log("Nonce:     ", tx.nonce);
  console.log("Signed by: ", (tx.confirmations || []).map((c) => c.owner).join(", ") || "nobody");
  console.log("Signatures:", (tx.confirmations || []).length, "/", tx.confirmationsRequired);
  console.log("------------------------------------------");

  const domainSeparator = hashDomain({
    domain: { chainId: BigInt(CHAIN_ID), verifyingContract: SAFE_ADDRESS },
    types: DOMAIN_TYPES,
  });
  const structHash = hashStruct({
    primaryType: "SafeTx",
    types: SAFE_TX_TYPES,
    data: {
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data || "0x",
      operation: tx.operation,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: tx.gasToken || ZERO,
      refundReceiver: tx.refundReceiver || ZERO,
      nonce: BigInt(tx.nonce),
    },
  });
  const safeTxHash = keccak256(concat(["0x19", "0x01", domainSeparator, structHash]));
  if (safeTxHash.toLowerCase() !== tx.safeTxHash.toLowerCase()) {
    throw new Error("Hash mismatch: the server's transaction data does not match its safeTxHash. Do NOT sign.");
  }
  console.log("Verified safeTxHash:", safeTxHash);

  console.log(">>> Guardian: approve on the Ledger emulator: http://localhost:5001");
  const sig = await eth.signEIP712HashedMessage(PATH, domainSeparator.slice(2), structHash.slice(2));
  const signature = "0x" + sig.r + sig.s + sig.v.toString(16);
  const signer = await recoverAddress({ hash: safeTxHash, signature });
  if (getAddress(signer) !== guardian) throw new Error("Signature does not match the Guardian Ledger");
  console.log("Signature OK from", signer);

  await apiKit.confirmTransaction(safeTxHash, signature);

  console.log("Confirmed! Now the user can execute in Safe:");
  console.log(`https://app.safe.global/transactions/queue?safe=sep:${SAFE_ADDRESS}`);
  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});