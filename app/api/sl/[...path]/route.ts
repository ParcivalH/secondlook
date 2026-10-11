// Second Look API: Lumi (risk, cooling-off chat, guardian brief, score) on top of the Safe backend.
// One catch-all handler so the whole surface reads in one place.
import SafeApiKit from "@safe-global/api-kit";
import { getAddress, isAddress, recoverAddress } from "viem";
import { z } from "zod/v4";
import { CHAIN_ID } from "@/lib/config";
import { buildTransfer } from "@/lib/buildTransfer";
import { safeTxHashes } from "@/lib/safeHash";
import { checkGuardedSafe } from "@/lib/safeCheck";
import { executeOnLedger, signMessageOnLedger } from "@/lib/guardian";
import { ledgerError } from "@/lib/ledger";
import { assess, timeline } from "@/lib/second-look/risk";
import { amountString, symOf, tokenOf, usd } from "@/lib/second-look/assets";
import { clearAccount, getAccount, liveAccount, requireLive, saveAccount } from "@/lib/second-look/account";
import { HttpError, type Store } from "@/lib/second-look/lumi/store";
import { aiInfo, getStore, ownerAllowance, renameAccount, resetHolder, safeEthBalance, safeUsdcBalance, save } from "@/lib/second-look/server";

const apiKit = () => new SafeApiKit({ chainId: BigInt(CHAIN_ID), apiKey: process.env.SAFE_API_KEY });

const addr = z.string().refine((a) => isAddress(a), "That address doesn't look right");
const Draft = z.object({
  to: addr,
  amount: z.number().positive(),
  label: z.string().max(60).optional(),
  pasted: z.boolean().optional(),
  owner: addr.optional(),
  txHash: z.string().optional(),
  route: z.enum(["allowance", "guardian"]).optional(),
  token: z.enum(["USDC", "ETH"]).optional(),
});
const Turn = z.object({ text: z.string().max(2000).optional(), quick: z.union([z.literal(0), z.literal(1)]).optional() });
const Decision = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(280).optional() });
const Rule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("limit"), from: z.number().positive(), to: z.number().min(10) }),
  z.object({ kind: z.literal("allow"), addr, label: z.string().min(1).max(60) }),
  z.object({ kind: z.literal("removeGuardian") }),
  z.object({ kind: z.literal("enableProtection"), limit: z.number().min(10) }),
]);
const SafeTxData = z.object({
  to: addr,
  value: z.coerce.string(),
  data: z.string().nullable(),
  operation: z.number(),
  safeTxGas: z.union([z.string(), z.number()]),
  baseGas: z.union([z.string(), z.number()]),
  gasPrice: z.union([z.string(), z.number()]),
  gasToken: z.string(),
  refundReceiver: z.string().nullable().optional(),
  nonce: z.union([z.string(), z.number()]),
});
const Propose = z.object({ safeTransactionData: SafeTxData, safeTxHash: z.string(), senderAddress: addr, senderSignature: z.string() });
const Setup = z.object({ safeAddress: addr, owner: addr, ownerName: z.string().trim().min(1).max(40), guardianName: z.string().trim().min(1).max(40) });
const Note = z.object({ note: z.string().max(280).optional() });
const Sig = z.object({ signer: addr, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) });

let lastSync = 0;
async function syncChain(owner?: string) {
  const store = await getStore();
  if (!liveAccount()) return { enabled: false, limit: 0, spent: 0, remaining: 0 };
  const allowance = await ownerAllowance(owner);
  if (Date.now() - lastSync > 10_000 || owner) {
    store.syncChain({ balance: await safeUsdcBalance(), ethBalance: await safeEthBalance(), dailyLimit: allowance.enabled ? allowance.limit : undefined });
    lastSync = Date.now();
  }
  return allowance;
}

async function view() {
  const store = await getStore();
  store.tick();
  const s = store.state;
  const open = store.openRequest();
  const acct = liveAccount();
  return {
    mode: acct ? "live" : "demo",
    safe: acct?.safeAddress ?? null,
    owner: acct?.ownerAddress ?? null,
    guardian: acct?.guardianAddress ?? null,
    now: store.now(),
    names: { owner: acct?.ownerName ?? "Dad", guardian: acct?.guardianName ?? "Mia" },
    ai: aiInfo(),
    account: { guardianActive: s.guardianActive, dailyLimit: s.dailyLimit, balance: s.balance, ethBalance: s.ethBalance ?? 0, allowlist: s.allowlist, history: s.history.slice(0, 20) },
    remainingToday: assess({ to: "0x0000000000000000000000000000000000000000", amount: 0 }, store.context()).remainingToday,
    open: open ? { ...open, timeline: timeline(open.createdAt, store.now()) } : null,
    latest: s.requests[0] ?? null,
    fyi: s.fyi.slice(0, 10),
    log: s.log.slice(0, 10),
    notifications: s.notifications.slice(0, 10),
  };
}

const describeReq = (r: ReturnType<Store["get"]>) => (r.kind === "transfer" ? `${r.amount} USDC to ${r.to}` : `rule change: ${r.title}`);

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const route = `${req.method} /${path.join("/")}`;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const store = await getStore();
  const id = path[0] === "requests" ? path[1] : undefined;
  const LIVE = !!liveAccount();
  const ok = async (data: unknown, status = 200) => {
    if (req.method === "POST") await save();
    return Response.json(data, { status });
  };

  // ---------- setup: which Safe, and who is who (from /setup) ----------
  if (route === "GET /setup") return Response.json(getAccount());
  if (route === "POST /setup") {
    const d = Setup.parse(body);
    const checked = await checkGuardedSafe(d.safeAddress, d.owner).catch((e: Error) => {
      throw new HttpError(400, e.message);
    });
    const before = getAccount();
    saveAccount({ safeAddress: checked.safeAddress, ownerAddress: checked.owner, ownerName: d.ownerName, guardianAddress: checked.guardian, guardianName: d.guardianName });
    // A different Safe starts a fresh account; renaming keeps the requests
    if (before?.safeAddress !== checked.safeAddress || before?.ownerAddress !== checked.owner) await resetHolder();
    else renameAccount(d.ownerName, d.guardianName);
    return Response.json(getAccount());
  }
  if (route === "POST /setup/clear") {
    clearAccount();
    await resetHolder();
    return Response.json(null);
  }

  // ---------- reads ----------
  if (route === "GET /state") {
    await syncChain();
    return Response.json(await view());
  }
  if (route === "POST /assess") {
    const d = Draft.parse(body);
    const allowance = await syncChain(d.owner);
    const token = symOf(d);
    const assessment = assess({ ...d, amount: usd(d.amount, token) }, store.context());
    // Low risk goes out under the on-chain allowance when there's room; otherwise it needs Mia.
    // The allowance module here only covers USDC, so live ETH always goes to Mia.
    const route =
      assessment.tier === "red"
        ? "guardian"
        : !LIVE
          ? "allowance"
          : token === "USDC" && allowance.enabled && d.amount <= allowance.remaining
            ? "allowance"
            : "guardian";
    return Response.json({ assessment, route, allowance });
  }
  if (id && route === `GET /requests/${id}`) return Response.json(store.get(id));
  if (id && route === `GET /requests/${id}/brief`) return ok(await store.brief(id));

  // ---------- owner ----------
  if (route === "POST /transfers") return ok(store.startTransfer(Draft.parse(body)), 201);
  if (id && route === `POST /requests/${id}/turn`) return ok(await store.answer(id, Turn.parse(body)));
  if (id && route === `POST /requests/${id}/cancel`) return ok(store.cancel(id));

  // Demo mode: hand the request to Mia without a real Safe transaction.
  if (id && route === `POST /requests/${id}/submit`) return ok(store.submit(id));

  // Live mode: Dad signed the Safe transaction in MetaMask. Check it is exactly this request, then queue it.
  if (id && route === `POST /requests/${id}/propose`) {
    if (!LIVE) throw new HttpError(400, "Not in live mode");
    const { safeAddress, ownerAddress } = requireLive();
    const p = Propose.parse(body);
    if (getAddress(p.senderAddress) !== ownerAddress) throw new HttpError(403, "Sign with the owner's wallet from setup");
    const r = store.get(id);
    const tx = p.safeTransactionData;
    if (r.kind === "transfer") {
      const token = symOf(r);
      const expected = buildTransfer(tokenOf(token), r.to, amountString(r.amount, token));
      if (getAddress(tx.to) !== getAddress(expected.to) || String(tx.value) !== expected.value || tx.data !== expected.data || tx.operation !== 0)
        throw new HttpError(400, "The signed transaction doesn't match this transfer");
    }
    const { safeTxHash } = safeTxHashes(safeAddress, tx);
    if (safeTxHash.toLowerCase() !== p.safeTxHash.toLowerCase()) throw new HttpError(400, "safeTxHash mismatch");
    await apiKit().proposeTransaction({
      safeAddress,
      safeTransactionData: { ...tx, value: String(tx.value), data: tx.data ?? "0x", safeTxGas: String(tx.safeTxGas), baseGas: String(tx.baseGas), gasPrice: String(tx.gasPrice), nonce: Number(tx.nonce), refundReceiver: tx.refundReceiver ?? "0x0000000000000000000000000000000000000000" },
      safeTxHash,
      senderAddress: getAddress(p.senderAddress),
      senderSignature: p.senderSignature,
      origin: "SecondLook",
    });
    return ok(
      store.submit(id, {
        safeAddress,
        chainId: CHAIN_ID,
        data: tx as unknown as Record<string, unknown>,
        safeTxHash,
        signatures: [{ signer: getAddress(p.senderAddress), data: p.senderSignature }],
      }),
    );
  }

  // Live mode: the Safe transaction with every confirmation so far, for whoever executes it.
  if (id && route === `GET /requests/${id}/safe-tx`) {
    const r = store.get(id);
    if (!r.safeTx) throw new HttpError(404, "No Safe transaction yet");
    return Response.json(await apiKit().getTransaction(r.safeTx.safeTxHash));
  }

  if (id && route === `POST /requests/${id}/executed`) {
    const { txHash } = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(body);
    return ok(store.executed(id, txHash));
  }

  if (route === "POST /rules") return ok(store.changeRule(Rule.parse(body)), 201);

  // ---------- guardian ----------
  // Demo approve, and reject in both modes (declining needs no signature).
  if (id && route === `POST /requests/${id}/decision`) {
    const d = Decision.parse(body);
    if (LIVE && d.decision === "approve") throw new HttpError(400, "Approving needs the signature from your Ledger");
    return ok(store.decide(id, d));
  }

  // Live approve: Mia's Ledger signed the SafeTx (EIP-712). Verify it's hers and an owner's, then add it to the Safe queue.
  if (id && route === `POST /requests/${id}/guardian-confirm`) {
    const { safeAddress } = requireLive();
    const { signer, signature } = Sig.parse(body);
    const r = store.get(id);
    if (!r.safeTx) throw new HttpError(409, "Dad hasn't signed this one yet");
    const who = await recoverAddress({ hash: r.safeTx.safeTxHash as `0x${string}`, signature: signature as `0x${string}` });
    if (getAddress(who) !== getAddress(signer)) throw new HttpError(400, "The signature isn't from this Ledger");
    const safe = await apiKit().getSafeInfo(safeAddress);
    if (!safe.owners.map((o) => getAddress(o)).includes(getAddress(signer))) throw new HttpError(403, "This Ledger isn't an owner of the account");
    await apiKit().confirmTransaction(r.safeTx.safeTxHash, signature);
    return ok(store.decide(id, { decision: "approve", signature: { signer: getAddress(signer), data: signature } }));
  }

  // Live, Ledger on the server (Speculos): one tap on the Ledger approves AND executes.
  // The Ledger signs one Ethereum tx calling execTransaction with Dad's signature + Mia's (msg.sender) — same as lib/guardian.ts.
  if (id && route === `POST /requests/${id}/guardian-approve`) {
    const acct = requireLive();
    const r = store.get(id);
    if (r.status !== "pending") throw new HttpError(409, r.status === "chat" ? `${acct.ownerName} hasn't sent this yet` : "This request is closed");
    try {
      if (r.safeTx) {
        const done = await executeOnLedger({ safeAddress: acct.safeAddress, safeTxHash: r.safeTx.safeTxHash, owner: acct.ownerAddress, guardian: acct.guardianAddress });
        return ok(store.decide(id, { decision: "approve", signature: { signer: done.guardian, data: done.guardianSignature }, executedTxHash: done.executionTxHash }));
      }
      // Off-chain rule (e.g. trust a new contact): nothing to execute, Mia signs a message on her Ledger
      const signed = await signMessageOnLedger(`SecondLook: APPROVE ${describeReq(r)}. Ref ${r.id}`, acct.guardianAddress);
      return ok(store.decide(id, { decision: "approve", ledger: { signer: signed.guardian, message: signed.message, signature: signed.signature } }));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, ledgerError(e));
    }
  }

  // Live reject: Mia signs a plain-text message on her Ledger. Nothing moves on-chain.
  if (id && route === `POST /requests/${id}/guardian-reject`) {
    const acct = requireLive();
    const { note } = Note.parse(body);
    const r = store.get(id);
    if (r.status !== "pending" && r.status !== "chat") throw new HttpError(409, "This request is closed");
    try {
      const signed = await signMessageOnLedger(`SecondLook: REJECT ${describeReq(r)}. Ref ${r.id}`, acct.guardianAddress);
      return ok(store.decide(id, { decision: "reject", note, ledger: { signer: signed.guardian, message: signed.message, signature: signed.signature } }));
    } catch (e) {
      throw new HttpError(400, ledgerError(e));
    }
  }

  // ---------- demo controls ----------
  if (route === "POST /demo/reset" && !LIVE) {
    store.reset();
    await save();
    return Response.json(await view());
  }
  if (route === "POST /demo/clock") {
    const { hours } = z.object({ hours: z.number().min(0).max(48) }).parse(body);
    store.advance(hours);
    await save();
    return Response.json(await view());
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

async function guarded(req: Request, ctx: Ctx) {
  try {
    return await handle(req, ctx);
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return Response.json({ error: err.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    if (err instanceof Error && err.message === "Empty answer") return Response.json({ error: "Type an answer or tap a reply" }, { status: 400 });
    console.error("[second-look]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 500 });
  }
}

export { guarded as GET, guarded as POST };
