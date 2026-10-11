const Eth = require("@ledgerhq/hw-app-eth").default;
const SpeculosHttpTransport = require("@ledgerhq/hw-transport-node-speculos-http").default;

const PATH = "44'/60'/0'/0/0";

async function main() {
  const transport = await SpeculosHttpTransport.open({ baseURL: "http://127.0.0.1", apiPort: "5001" });
  const eth = new Eth(transport);
  const { address } = await eth.getAddress(PATH);
  console.log("Ledger (Speculos) address:", address);
  await transport.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});