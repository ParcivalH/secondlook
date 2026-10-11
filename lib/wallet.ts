import { getAddress, type EIP1193Provider } from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const SEPOLIA_HEX = "0xaa36a7";

export async function connectOwnerWallet(): Promise<`0x${string}`> {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  if ((await window.ethereum.request({ method: "eth_chainId" })) !== SEPOLIA_HEX) {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] });
  }
  return getAddress(account);
}

export async function openSafe(signer: string, safeAddress: string) {
  const { default: Safe } = await import("@safe-global/protocol-kit");
  type SafeProvider = Parameters<typeof Safe.init>[0]["provider"];
  const kit = await Safe.init({ provider: window.ethereum as unknown as SafeProvider, signer, safeAddress });
  if (!(await kit.isOwner(signer))) throw new Error(`${signer} is not an owner of this Safe`);
  return kit;
}