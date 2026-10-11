const Eth = require("@ledgerhq/hw-app-eth").default;
const SpeculosHttpTransport = require("@ledgerhq/hw-transport-node-speculos-http").default;
const Safe = require("@safe-global/protocol-kit").default;
const SafeApiKit = require("@safe-global/api-kit").default;
const { getAddress, parseEther, hashDomain, hashStruct, keccak256, concat, recoverAddress } = require("viem");

const PATH = "44'/60'/0'/0/0";
const CHAIN_ID = 11155111;
const { SAFE_ADDRESS, SAFE_API_KEY, RECIPIENT, AMOUNT_ETH, SEPOLIA_RPC_URL } = process.env;

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
  const ledger = getAddress((await eth.getAddress(PATH)).address);
  console.log("Ledger:", ledger);

  const kit = await Safe.init({ provider: SEPOLIA_RPC_URL, safeAddress: SAFE_ADDRESS });
  if (!(await kit.isOwner(ledger))) throw new Error("Ledger is not an owner of this Safe");

  const safeTx = await kit.createTransaction({ transactions: [ { to: RECIPIENT, value: parseEther(AMOUNT_ETH).toString(), data: "0x" } ] }); 
  const tx = safeTx.data;
  console.log("Safe tx:", tx);

  const domainSeparator = hashDomain({
    domain: { chainId: BigInt(CHAIN_ID), verifyingContract: SAFE_ADDRESS },
    types: DOMAIN_TYPES,
  });
  const structHash = hashStruct({
    primaryType: "SafeTx",
    types: SAFE_TX_TYPES,
    data: {
      ...tx,
      value: BigInt(tx.value), safeTxGas: BigInt(tx.safeTxGas), baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice), nonce: BigInt(tx.nonce),
    },
  });

  const safeTxHash = keccak256(concat(["0x19", "0x01", domainSeparator, structHash]));
  if (safeTxHash !== (await kit.getTransactionHash(safeTx))) throw new Error("hash mismatch");
  console.log("safeTxHash:", safeTxHash);

  console.log(">>> Approve the signature on the emulator: http://localhost:5001");
  const sig = await eth.signEIP712HashedMessage(PATH, domainSeparator.slice(2), structHash.slice(2));

  const signature =  "0x" + sig.r + sig.s + sig.v.toString(16);
  const signer = await recoverAddress({ hash: safeTxHash, signature });
  if (getAddress(signer) !== ledger) throw new Error("signature does not match Ledger");
  console.log("Signature OK from", signer);

    const apiKit = new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: SAFE_API_KEY });
  await apiKit.proposeTransaction({
    safeAddress: SAFE_ADDRESS,
    safeTransactionData: tx,
    safeTxHash: safeTxHash,
    senderAddress: ledger,
    senderSignature: signature,
  });

  console.log("Proposed! Open Safe to check:");
  console.log(`https://app.safe.global/transactions/queue?safe=sep:${SAFE_ADDRESS}`);
  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});