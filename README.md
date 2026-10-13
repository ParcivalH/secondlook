# Second Look

**A guardian co-signs big or unusual crypto transfers on her Ledger. Lumi, an AI agent, watches every transfer for scam patterns and explains the risk to both sides, but it can never sign.**

Ledger N3XT Hackathon @ Op3n 2026.

Investment scams ("pig butchering") are the largest category of reported crypto fraud losses. The victim isn't hacked: they send the money themselves, often to pay a "tax" or "fee" to withdraw profits that don't exist. A hardware wallet doesn't help when the owner is the one pressing the buttons. Second Look adds a second person.

## How it works

- **Everyday transfers:** Lumi checks every transfer. Small, ordinary ones with no scam signals go straight out through the Safe's on-chain daily allowance. Dad signs once in MetaMask; Mia isn't bothered (she gets a heads-up for a new address).
- **Anything big or unusual** (above the daily limit, a reported address, small-then-large or escalating amounts, a burst of transfers, a large share of the balance, weeks of quiet then a large transfer): Lumi has a short, kind cooling-off chat with Dad (below), then the transfer becomes a Safe transaction that needs **both** signatures: Dad in MetaMask, Mia on her Ledger.
- **Mia's brief:** a 0–99 risk score with what drove it (the transfer, the recipient, what Dad told Lumi), how it moved during the chat, what the payment is for, which steps of a known scam it matches ("4 of 5 steps seen"), Dad's own words, and Lumi's read. She can read along while Dad is still talking with Lumi and reject at any time; approving opens once Dad sends it to her. She approves on her Ledger or declines.
- **Rules are on-chain:** raising the limit or removing the guardian are Safe transactions too, so they need Mia's Ledger. Requests expire after 24 hours; doing nothing never sends money.
- **Trusted contacts (allowlist):** an address Mia has approved a transfer to becomes a trusted contact, so later transfers there aren't flagged as new. Dad can also ask to add one in Settings; the list lives off-chain, so Mia approves it by signing a message on her Ledger (`SecondLook: APPROVE …`), which the server checks came from the guardian. Trusted contacts never lift the daily limit: big transfers still need Mia. If a transfer to a trusted contact is only over the limit, with no scam signal, Lumi skips the questions ("This is above your daily limit, so Mia confirms. No questions needed."). Any scam signal (escalating amounts, the amount changed again and again, a long pause on the send screen, a reported address, weeks of quiet then a large transfer) means the full check, trusted or not.

## How Lumi checks a transfer

Scope: financial scams. Investment platforms that want a fee to withdraw, callers who move money to a "safe account", and urgent requests to help someone in trouble. (Romance scams are out of scope for now.)

1. **What's it for?** Six plain answers: investing, paying someone I know, a bill or purchase, moving money to keep it safe, helping someone in trouble, something else. The answer picks the path and can't be changed later.
2. **Two or three factual questions for that path.** Facts, not judgements ("Have you taken money out of it before?", not "Is this a scam?"). Every question has concrete answers plus **Not sure**, which is a fine answer, and Dad can always type in his own words.

   | Path | Questions |
   | --- | --- |
   | Investment | How did you first hear about it? · Have you taken money out before? · Whose idea was this amount? |
   | Safe account | Who told you your money was at risk? · Is anyone on the phone with you right now? · Did anyone ask you to hurry or keep it quiet? |
   | Helping someone | Who are you helping? · Have you spoken on live video or called back on a number you had? · Hurry or keep it quiet? |
   | Everyday (someone I know, a bill, something else) | Anyone on the phone with you right now? · Where did this address come from? · Hurry or keep it quiet? |

   Some answers settle two things at once ("I tried, but they want a fee first" is also the fee step), and a question already answered by something Dad typed earlier is skipped.
3. **One thing to check yourself**, when the answers match a pattern: withdraw 10 USDC first; hang up and call the number on your card; call them back on the number you've always had.
4. **Four ways out:** Call Mia now · I'll check first and come back (the request stays saved for its 24 hours, nothing moves, no penalty; Mia sees that he chose to check) · Send to Mia to confirm · Cancel.

The patterns and their steps (shown to Mia as "N of M steps seen") live in `lib/second-look/risk/conversation.ts`:

| Pattern | Steps |
| --- | --- |
| Investment scam | Met through someone online or an ad · small amounts first, now much more · hasn't been able to take money out · someone else chose the amount · a "tax" or fee to unlock a withdrawal |
| "Safe account" scam | Told his money is at risk · someone guiding him live · asked to hurry or keep it quiet · money goes to a new address |
| Emergency scam | Someone close suddenly needs money · hasn't checked it's really them · asked to hurry or keep it quiet · money goes to a new address |

**Behaviour signals.** The amount being changed three or more times and more than three minutes on the send screen are measured on the device; they add to the score and turn on the full check, but never send or block anything by themselves. Escalating amounts to the same address and weeks of quiet then a large transfer come from the history; they count as unusual, so the transfer needs Mia.

**Without an API key** Lumi reads typed answers with a keyword reader: it settles the question being asked, and also picks up strong warning phrases anywhere in the message (so "No, but they say I need to pay a 20% tax first to withdraw" answers the phone question *and* raises the fee step), ignoring phrases that are negated ("nobody is guiding me"). With `ANTHROPIC_API_KEY`, Claude reads them instead, under the same escalate-only rules.

`npm test` (`tsx --test scripts/check-lumi.ts`) runs the checks for the rules, every path, escalate-only reading, the light path, behaviour signals and what the guardian can do while Dad is still talking.

## What the agent decides, and what only a human can

| | Who | Enforced by |
| --- | --- | --- |
| Whether a transfer needs the guardian | Deterministic rules (`lib/second-look/risk`) | Code; the model can't change the tier |
| Daily limit | Safe Allowance Module | The contract reverts above the allowance |
| Moving money above the limit, loosening a rule | Dad **and** Mia | Safe threshold 2 of 2; Mia's key is on her Ledger |
| Reading Dad's free-text answers into warning signs | **Lumi (Claude)** | Escalate-only: a "yes" can never become "no"; the model can clear only the question it just asked, and can't change the purpose once it's chosen. Tapped answers are read by code, instantly |
| The wording of the chat and the brief | **Lumi (Claude)** | Guardrails: no approval language, no "safe to send", no links, addresses or seed-phrase talk |
| The risk score | Fixed rules + settled answers | Claude never writes the number |
| Approve or reject | **Mia** | Her Ledger signature; the server holds no keys |

## Architecture

```
app/page.tsx                    Second Look UI: Dad's phone and Mia's laptop (components/second-look)
app/api/sl/[...path]/route.ts   Lumi + request API: assess, chat turns, check first, call, brief + score, propose, guardian confirm, executed
lib/second-look/risk            Risk tiers and signals, purpose-first question bank, patterns, self-checks, risk score, expiry
lib/second-look/lumi            Lumi (Claude structured output), guardrails, prompts, request store
lib/second-look/owner-client.ts Dad's MetaMask: allowance transfers, sign + propose Safe txs, execute
lib/second-look/ledger-client.ts Mia's Ledger via the Device Management Kit (WebHID or Speculos): EIP-712 SafeTx signing
lib/second-look/server.ts       Store singleton (mirrored to .data/), Safe balance and allowance reads
lib/safeHash.ts, buildTransfer.ts, wallet.ts, config.ts, tokens.ts   Safe plumbing (unchanged)
scripts/check-lumi.ts           Checks for Lumi's rules (npm test)
app/api/transfers, app/classic, app/transfer, scripts/*.cjs      The original MetaMask + Safe Transaction Service flow and Speculos CLI scripts
```

The Safe Transaction Service holds the signatures: Dad's proposal (`proposeTransaction`), then Mia's confirmation (`confirmTransaction`). The server verifies both before forwarding: the signed SafeTx must be exactly the requested transfer and hash to the same safeTxHash, and Mia's signature must recover to a Safe owner. Mia's browser re-derives the EIP-712 payload and refuses to sign if it doesn't hash to what Dad signed.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

**Demo mode** (no Safe set up): everything runs in the app with simulated wallet and Ledger steps. On Dad's phone, "Send money" has demo shortcuts:
- **Grocery, 40**: everyday payment, goes straight out.
- **Trusted, 800**: a trusted contact, only above the limit. Light path: Mia confirms, no questions.
- **New contact, 80**: small, new address. Goes out; Mia gets a heads-up.
- **"Platform", 5,000**: the scam. Answer Lumi in your own words ("It's for my trading platform", "A friend from a WhatsApp group", "No, they say I need to pay a 20% tax first to withdraw") or tap the answers, and watch Mia's score and the scam steps fill in.

`#dad` and `#mia` open one device each. "Reset demo" starts over; "+4 hours" / "+20 hours" move the clock to show reminders and expiry.

**Live mode on Sepolia:**
1. Set `SAFE_API_KEY` and `SEPOLIA_RPC_URL`, then open `/setup` with a 2-of-2 Safe (Dad's MetaMask + Mia's Ledger) funded with Sepolia USDC.
2. Guardian device: `NEXT_PUBLIC_LEDGER_TRANSPORT=speculos` with Speculos running (REST API on `SPECULOS_URL`, default port 5001), or `webhid` for a real Ledger in Chrome/Edge.
3. Turn on the daily limit once: Dad → Settings → "Ask Mia to turn it on" (MetaMask signs the setup batch: enable the Allowance Module, add Dad as delegate, set the allowance) → Mia approves on her Ledger → Dad presses Send now.
4. Small transfer: goes out through the allowance with one MetaMask transaction.
5. Scam transfer: Lumi's chat → Dad signs in MetaMask → Mia sees the brief and score, approves on her Ledger → Dad presses Send now.

`ANTHROPIC_API_KEY` turns on Claude for Lumi; without it Lumi uses scripted questions and the keyword reader.

## Verified so far

- `next build` passes and `npm test` passes (20 checks).
- Demo mode walked end to end in Chromium: the scam answered in free text (investing path, 5 of 5 steps, check first, call Mia, send, reject), the trusted-contact light path (approve), the helping path (emergency pattern), an everyday path with "Not sure", plus small transfers, rule changes and expiry.
- Live mode server paths with a stub Safe: risk routing, the signed-transaction check, and the guardian Ledger screen loading the Device Management Kit, verifying the safeTxHash and decoding the call before asking the device.
- Not yet verified against a real Safe: MetaMask signing and proposal, Mia's EIP-712 signature through Speculos, confirmation and execution, and the Allowance Module setup and transfers. Steps above.

## Honest limits

- Below the on-chain allowance, red-tier flags route to Mia in the app, but Dad's wallet could still call the module directly. Dad is the person being protected; the scammer doesn't hold his keys.
- Behaviour signals (amount changes, time on the send screen) are reported by Dad's device, so they're hints for the score, not enforcement.
- Lowering the limit applies in the app immediately; the on-chain value changes the next time Mia signs.
- One family per server; requests are kept in memory and mirrored to `.data/`.

## Developer experience feedback (Ledger)

_To fill in after the Sepolia run._

We used AI assistants as tools while building, as the hackathon rules allow.
