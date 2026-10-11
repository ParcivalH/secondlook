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

  // TODO 1：写交易单
  // 提示：kit.createTransaction({ transactions: [ { to: ..., value: ..., data: ... } ] })
  //       to 填 RECIPIENT；value 填 parseEther(AMOUNT_ETH).toString()；data 填 "0x"
  //       注意这个函数要用 await
  const safeTx = null;
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

  // TODO 2：safeTxHash = keccak256( "0x1901" + domainSeparator + structHash )
  // 提示：keccak256(concat([ 第一部分, 第二部分, 第三部分 ]))
  const safeTxHash = null;
  if (safeTxHash !== (await kit.getTransactionHash(safeTx))) throw new Error("hash mismatch");
  console.log("safeTxHash:", safeTxHash);

  console.log(">>> 去 http://localhost:5001 在模拟器上确认签名");
  const sig = await eth.signEIP712HashedMessage(PATH, domainSeparator.slice(2), structHash.slice(2));

  // TODO 3：签名 = "0x" + r + s + v(十六进制)
  // 提示：sig.r、sig.s 是不带 0x 的字符串；sig.v 是 27 或 28，sig.v.toString(16) 会变成 "1b" 或 "1c"
  const signature = null;
  const signer = await recoverAddress({ hash: safeTxHash, signature });
  if (getAddress(signer) !== ledger) throw new Error("signature does not match Ledger");
  console.log("Signature OK from", signer);

  // TODO 4：提交给 Safe 服务器
  // 提示：const apiKit = new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: SAFE_API_KEY });
  //       await apiKit.proposeTransaction({
  //         safeAddress: ..., safeTransactionData: ..., safeTxHash: ...,
  //         senderAddress: ..., senderSignature: ...,
  //       });
  //       想想每个 ... 应该填上面哪个变量


  console.log("Proposed! 打开 Safe 查看：");
  console.log(`https://app.safe.global/transactions/queue?safe=sep:${SAFE_ADDRESS}`);
  await transport.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});