# Second Look

**A trusted second look. Confirmed on Ledger.**

Second Look is a scam-prevention MVP that brings a trusted guardian into consequential crypto payments. Everyday spending stays simple; payments above an agreed daily allowance require the account owner and guardian to approve together.

## The problem

A scammer can convince someone to authorize a payment without stealing their keys. In an investment scam, for example, the victim may willingly pay a supposed tax to withdraw fictitious profits. Second Look adds an independent person who can review the situation before the money moves.

## How it works

- **Funds:** a Safe smart account with two owners: the payer's software wallet and the guardian's Ledger account. Its normal transaction path requires both signatures.
- **Everyday spending:** Safe's Allowance Module lets the payer spend within a daily USDC allowance using MetaMask. The on-chain allowance limits this separate spending path.
- **Review:** Lumi asks factual questions tailored to the payment's purpose. Fixed rules calculate an explainable risk score; Claude can interpret free-text answers and surface warning signs. Lumi holds no signing keys and cannot approve or send funds.
- **Guardian signing:** the implemented client uses Ledger's Device Management Kit and Ethereum Device Signer Kit for EIP-712 SafeTx signing, through WebHID or Speculos. It re-computes the transaction hash before asking for a signature. Safe verifies the required signatures for execution.
- **Protection changes:** raising the on-chain allowance or removing the guardian requires joint authorization. Application review requests expire after 24 hours and never automatically approve.

## Run the demo

With Node.js and npm installed:

```bash
git clone https://github.com/ParcivalH/secondlook.git
cd secondlook
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Without a configured Safe, wallet and Ledger steps are simulated. Try **Grocery, 40** for everyday spending and **"Platform", 5,000** for the investment-scam review. **Reset demo** starts again; `#dad` and `#mia` show each person's view. `ANTHROPIC_API_KEY` enables Claude; without it, scripted questions and a keyword reader work. Run `npm test` for Lumi's checks.

## Live configuration and current limits

For Sepolia, set `SAFE_API_KEY` and `SEPOLIA_RPC_URL`, then configure a funded 2-of-2 Safe at `/setup`. Use `NEXT_PUBLIC_LEDGER_TRANSPORT=webhid` for a physical Ledger in Chrome/Edge, or `speculos` with the emulator at `SPECULOS_URL`. Enable the allowance through the jointly signed Settings flow.

The repository reports a passing build, 20 Lumi checks and browser-demo verification. Full signing, confirmation, execution and allowance tests against a real Safe remain listed as unverified. Below the allowance, high-risk routing is enforced by the app and can be bypassed by a direct module call. The MVP uses a 2-of-2 setup and one family per server; lost-key recovery and production hardening remain future work.

[Repository and detailed implementation notes](https://github.com/ParcivalH/secondlook)
