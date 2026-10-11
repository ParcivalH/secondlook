# Second Look

**A guardian co-signs big or unusual crypto transfers on her Ledger. Lumi, an AI agent, watches every transfer for scam patterns and explains the risk to both sides, but it can never sign.**

Ledger N3XT Hackathon @ Op3n 2026.

Investment scams ("pig butchering") are the largest category of reported crypto fraud losses. The victim isn't hacked: they send the money themselves, often to pay a "tax" or "fee" to withdraw profits that don't exist. A hardware wallet doesn't help when the owner is the one pressing the buttons. Second Look adds a second person.

## How it works

- **Everyday transfers:** Lumi checks every transfer. Small, ordinary ones with no scam signals go straight out through the Safe's on-chain daily allowance. Dad signs once in MetaMask; Mia isn't bothered (she gets a heads-up for a new address).
- **Anything big or unusual** (above the daily limit, a reported address, small-then-large to a new address, a burst of transfers, a large share of the balance): Lumi has a short, kind cooling-off chat with Dad, then the transfer becomes a Safe transaction that needs **both** signatures: Dad in MetaMask, Mia on her Ledger.
- **Mia's brief:** a 0–99 risk score with what drove it (the transfer, the recipient, what Dad told Lumi), how it moved during the chat, Dad's own words, and Lumi's read. She approves on her Ledger (EIP-712 SafeTx signature) or declines. Once both signatures are in, Dad presses **Send now** and the Safe executes it.
- **Rules are on-chain:** raising the limit or removing the guardian are Safe transactions too, so they need Mia's Ledger. Requests expire after 24 hours; doing nothing never sends money.

## What the agent decides, and what only a human can

| | Who | Enforced by |
| --- | --- | --- |
| Whether a transfer needs the guardian | Deterministic rules (`lib/second-look/risk`) | Code; the model can't change the tier |
| Daily limit | Safe Allowance Module | The contract reverts above the allowance |
| Moving money above the limit, loosening a rule | Dad **and** Mia | Safe threshold 2 of 2; Mia's key is on her Ledger |
| Reading Dad's free-text answers into warning signs | **Lumi (Claude)** | Escalate-only: a "yes" can never become "no"; the model can clear only the question it just asked |
| The wording of the chat and the brief | **Lumi (Claude)** | Guardrails: no approval language, no "safe to send", no links, addresses or seed-phrase talk |
| The risk score | Fixed rules + settled answers | Claude never writes the number |
| Approve or reject | **Mia** | Her Ledger signature; the server holds no keys |

## Architecture

```
app/page.tsx                    Second Look UI: Dad's phone and Mia's laptop (components/second-look)
app/api/sl/[...path]/route.ts   Lumi + request API: assess, chat turns, brief + score, propose, guardian confirm, executed
lib/second-look/risk            Risk tiers, cooling-off questions, flag merging, risk score, expiry
lib/second-look/lumi            Lumi (Claude structured output), guardrails, prompts, request store
lib/second-look/owner-client.ts Dad's MetaMask: allowance transfers, sign + propose Safe txs, execute
lib/second-look/ledger-client.ts Mia's Ledger via the Device Management Kit (WebHID or Speculos): EIP-712 SafeTx signing
lib/second-look/server.ts       Store singleton (mirrored to .data/), Safe balance and allowance reads
lib/safeHash.ts, buildTransfer.ts, wallet.ts, config.ts, tokens.ts   Safe plumbing (unchanged)
app/api/transfers, app/classic, app/transfer, scripts/            The original MetaMask + Safe Transaction Service flow and Speculos CLI scripts
```

The Safe Transaction Service holds the signatures: Dad's proposal (`proposeTransaction`), then Mia's confirmation (`confirmTransaction`). The server verifies both before forwarding: the signed SafeTx must be exactly the requested transfer and hash to the same safeTxHash, and Mia's signature must recover to a Safe owner. Mia's browser re-derives the EIP-712 payload and refuses to sign if it doesn't hash to what Dad signed.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

**Demo mode** (no Safe set up yet): everything runs in the app with simulated wallet and Ledger steps. Use "Demo shortcuts → 'Platform', 5,000" on Dad's phone, answer Lumi in your own words, and watch Mia's score climb. `#dad` and `#mia` open one device each.

**Live mode on Sepolia:**
1. Create a 2-of-2 Safe (Dad's MetaMask + Mia's Ledger), fund it with Sepolia USDC, and give the Ledger address a little Sepolia ETH (it pays gas when Mia approves). Set `SAFE_API_KEY` and `SEPOLIA_RPC_URL` in `.env.local`.
2. Open `/setup` (or "Use my Safe (live)"): connect MetaMask, pick the Safe, name owner and guardian. The server checks it is 2-of-2 and saves it in `.data/`, so Dad's phone and Mia's laptop see the same account. "Back to demo" clears it.
3. Guardian device: Speculos running with the Ethereum app open and blind signing on (`SPECULOS_PORT`, default 5001). The server talks to it (`lib/ledger.ts`). For a real Ledger in Chrome/Edge set `NEXT_PUBLIC_LEDGER_TRANSPORT=webhid` instead (browser EIP-712 signature, then Dad presses Send now).
4. Turn on the daily limit once: Dad → Settings → "Ask Mia to turn it on" (MetaMask signs the setup batch) → Mia presses "Wake my Ledger" and approves on the device: one tap adds her signature and executes it.
5. Small transfer: goes out through the allowance with one MetaMask transaction.
6. Scam transfer: Lumi's chat → Dad signs in MetaMask → Mia sees the brief and score → approve (one tap on the Ledger executes the transfer) or reject (the Ledger signs a "SecondLook: REJECT …" message; nothing moves).

The classic flow without Lumi is still at `/classic` → `/transfer` → `/guardian`.

`ANTHROPIC_API_KEY` turns on Claude for Lumi; without it Lumi uses scripted questions.

## Verified so far

- `next build` passes; demo mode walked end to end in Chromium (scam chat, brief with score, reject, small transfer, rule change).
- Live mode server paths with a stub Safe: risk routing, the signed-transaction check, and the guardian Ledger screen loading the Device Management Kit, verifying the safeTxHash and decoding the call before asking the device.
- Verified on Sepolia with Speculos in the classic flow: owner signs in MetaMask, guardian's Ledger approves and executes in one tap, reject signed on the Ledger.
- Not yet verified against a real Safe in the Second Look UI: the same steps from Mia's screen, and the Allowance Module setup and transfers. Steps above.

## Honest limits

- Below the on-chain allowance, red-tier flags route to Mia in the app, but Dad's wallet could still call the module directly. Dad is the person being protected; the scammer doesn't hold his keys.
- Lowering the limit applies in the app immediately; the on-chain value changes the next time Mia signs.
- One family per server; requests are kept in memory and mirrored to `.data/`.

## Developer experience feedback (Ledger)

_To fill in after the Sepolia run._

We used AI assistants as tools while building, as the hackathon rules allow.
