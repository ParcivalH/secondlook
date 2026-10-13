"use client";

import { useEffect, useRef, useState } from "react";
import { ago, api, hoursLeft, isOpen, money, short, type Brief, type Req, type SafeTxWire } from "./api";
import { RiskScoreCard } from "./RiskScore";
import { fmtAmount, symOf } from "@/lib/second-look/assets";
import { ErrorText, Lit, Lumi, useApp } from "./shared";

type Screen = { name: "inbox" } | { name: "brief" } | { name: "ledger"; action: "approve" | "reject" | "invite" };

export function Mia() {
  const { state } = useApp();
  const [screen, setScreen] = useState<Screen>({ name: "inbox" });
  const [note, setNote] = useState(`${state.names.owner}, call me when you see this. Love you.`);
  const open = state.open;

  useEffect(() => {
    if (screen.name !== "inbox" && !isOpen(open)) setScreen({ name: "inbox" });
  }, [open, screen.name]);

  if (screen.name === "ledger" && isOpen(open)) return <LedgerScreen req={open} action={screen.action} note={note} back={() => setScreen(screen.action === "invite" ? { name: "inbox" } : { name: "brief" })} />;
  if (screen.name === "brief" && isOpen(open)) return <BriefScreen req={open} note={note} setNote={setNote} go={setScreen} />;
  return <Inbox go={setScreen} />;
}

function Inbox({ go }: { go: (s: Screen) => void }) {
  const { state } = useApp();
  const { names, account, open } = state;
  const invite = isOpen(open) && open.kind === "rule" && open.change.kind === "enableProtection" ? open : null;

  if (!account.guardianActive) {
    if (!invite)
      return (
        <div className="stack center fade" style={{ paddingTop: 100 }}>
          <Lumi />
          <h2 className="title">No invites yet</h2>
          <p className="meta" style={{ fontSize: 17 }}>
            When {names.owner} picks you as his guardian, the invite shows up here.
          </p>
        </div>
      );
    const limit = invite.change.kind === "enableProtection" ? invite.change.limit : account.dailyLimit;
    return (
      <div className="stack fade">
        <div style={{ alignSelf: "center" }}>
          <Lumi />
        </div>
        <h2 className="title" style={{ textAlign: "center" }}>
          {names.owner} has asked you to be his guardian
        </h2>
        <p style={{ textAlign: "center" }}>You'll be asked to approve his large or unusual transfers. Each request comes with a short summary.</p>
        <div className="card">
          <span className="li">· You can't move his money. You can only approve or decline.</span>
          <span className="li">· Daily limit he chose: {money(limit)} USDC. Anything above it comes to you.</span>
          <span className="li">· No response within 24 hours cancels the request. Doing nothing never sends money.</span>
          <span className="li">· Removing you as guardian also needs your approval.</span>
        </div>
        <button className="btn primary" type="button" onClick={() => go({ name: "ledger", action: "invite" })}>
          Confirm on Ledger
        </button>
      </div>
    );
  }

  return (
    <div className="stack fade">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="title">Guardian for {names.owner}</h2>
        <span className="pill g">
          <span className="d" />
          Protection on
        </span>
      </div>
      {isOpen(open) ? (
        <div className="req">
          <span className="pill" style={{ background: "var(--brick-tint)" }}>
            <span className="d" />
            Needs your decision
          </span>
          <strong className="sub">
            {open.kind === "transfer" ? `${names.owner} wants to send ${fmtAmount(open.amount, symOf(open))} to ${open.label}${open.assessment.isNewAddress ? " (a new address)" : ""}` : open.title}
          </strong>
          {open.kind === "transfer" && (
            <span className="li">
              {open.conversation.callRequested
                ? `${names.owner} would like you to call him.`
                : open.status === "chat"
                  ? open.conversation.checkingFirst
                    ? `${names.owner} chose to check first. Nothing has moved.`
                    : `${names.owner} is talking with Lumi now. You can read along.`
                  : open.conversation.light
                    ? "A trusted contact, only above his daily limit."
                    : `${names.owner} has sent it to you to confirm.`}
            </span>
          )}
          <span className="meta">
            Requested {ago(open.createdAt, state.now)} · expires in {hoursLeft(open, state.now)}h · reminder {Math.max(1, open.remindersSent ?? 1)} of 3 sent
          </span>
          <button className="btn primary" type="button" onClick={() => go({ name: "brief" })} style={{ alignSelf: "flex-start" }}>
            Review
          </button>
        </div>
      ) : (
        <div className="card">
          <strong>Nothing needs your decision</strong>
          <span className="meta">Everyday payments under {money(account.dailyLimit)} USDC a day go through without you.</span>
        </div>
      )}
      <div className="grid2">
        <div className="card">
          <strong>Heads-ups</strong>
          {state.fyi.length ? (
            state.fyi.slice(0, 5).map((f, i) => (
              <span className="li" key={i}>
                · {f.text} <span className="meta">{ago(f.ts, state.now)}</span>
              </span>
            ))
          ) : (
            <span className="meta">Small transfers to new addresses show up here. No action needed.</span>
          )}
        </div>
        <div className="card">
          <strong>Your decisions</strong>
          {state.log.length ? (
            state.log.slice(0, 5).map((f, i) => (
              <span className="li" key={i}>
                · {f.text} <span className="meta">{ago(f.ts, state.now)}</span>
              </span>
            ))
          ) : (
            <span className="meta">Nothing yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefScreen({ req, note, setNote, go }: { req: Req; note: string; setNote: (s: string) => void; go: (s: Screen) => void }) {
  const { state } = useApp();
  const { owner } = state.names;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lines = req.kind === "transfer" ? req.conversation.lines.length : 0;

  // Re-read the brief whenever the conversation grows: Lumi keeps it current while Dad is still talking.
  useEffect(() => {
    if (req.kind !== "transfer") return;
    let live = true;
    api.brief(req.id).then(
      (b) => live && setBrief(b),
      (e: Error) => live && setErr(e.message),
    );
    return () => {
      live = false;
    };
  }, [req.id, req.kind, lines]);

  const back = (
    <button className="link" type="button" onClick={() => go({ name: "inbox" })} style={{ alignSelf: "flex-start" }}>
      ‹ Inbox
    </button>
  );
  const notYet = req.status === "chat";
  const actions = (
    <>
      {notYet && (
        <p className="meta" style={{ fontSize: 15 }}>
          Approving opens once {owner} sends this to you. You can reject it anytime.
        </p>
      )}
      <label className="field">
        Leave {owner} a note (optional)
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
      </label>
      <div className="row">
        <button className="btn primary" type="button">
          Call {owner} first
        </button>
        <button className="btn reject" type="button" onClick={() => go({ name: "ledger", action: "reject" })}>
          Reject
        </button>
        <button className="btn" type="button" disabled={notYet} onClick={() => go({ name: "ledger", action: "approve" })}>
          Approve on Ledger
        </button>
      </div>
      <span className="meta">Expires in {hoursLeft(req, state.now)}h. If you do nothing, nothing changes.</span>
    </>
  );

  if (req.kind === "rule")
    return (
      <div className="stack fade">
        {back}
        <span className="pill" style={{ background: "var(--brick-tint)" }}>
          <span className="d" />
          Rule change · Waiting for you
        </span>
        <h2 className="title" style={{ fontSize: 34 }}>
          {req.title}
        </h2>
        <div className="box tint-yel">
          <span className="li" style={{ fontSize: 16 }}>
            {req.detail}
          </span>
        </div>
        <div className="box tint-red">
          <span className="li" style={{ fontSize: 16 }}>
            <b>Worth a call:</b> people running scams often ask victims to turn protection off or add "their" address first. If {owner} didn't plan this, reject it.
          </span>
        </div>
        {actions}
      </div>
    );

  const high = brief?.risk === "high";
  return (
    <div className="stack fade">
      {back}
      <Lit>
        <div className="head-c">
          <span className="pill look">Needs your look{brief ? (high ? " · High risk" : " · Unusual") : ""}</span>
          <span className="meta">{owner} is trying to send</span>
          <h2 className="big" style={{ fontSize: 36 }}>
            {fmtAmount(req.amount, symOf(req))} to {req.label}
          </h2>
          <span className="meta">
            {short(req.to)}
            {req.assessment.isNewAddress ? " · new address" : " · trusted contact"}
          </span>
          {brief?.purpose && (
            <span className="pill" style={{ background: "var(--card-2)", marginTop: 6 }}>
              For: {brief.purpose}
            </span>
          )}
        </div>
        {brief?.light && (
          <div className="box tint-grn">
            <span className="li" style={{ fontSize: 16 }}>
              <b>{req.label} is a trusted contact.</b> {`This is only above ${owner}'s daily limit, with no scam signal, so Lumi didn't ask him questions. Trusted contacts never lift the limit, so it still needs you.`}
            </span>
          </div>
        )}
        {(brief?.callRequested || brief?.checkingFirst) && (
          <div className="box tint-yel">
            {brief.callRequested && <span className="li" style={{ fontSize: 16 }}><b>{owner} would like you to call him.</b> The transfer is on hold.</span>}
            {brief.checkingFirst && <span className="li" style={{ fontSize: 16 }}>{owner} chose to check first{brief.selfCheck ? ` (Lumi suggested: ${brief.selfCheck.replace(/\.$/, "")})` : ""}. Nothing has moved.</span>}
          </div>
        )}
        {brief?.source === "ai" && <p style={{ textAlign: "center", fontWeight: 700 }}>{brief.headline}</p>}
        {brief && <RiskScoreCard score={brief.score} trail={brief.scoreTrail} live={!req.conversation.done} />}
        {brief?.matches && (
          <div className="card">
            <strong>
              Matches {brief.matches.steps.filter((x) => x.seen).length} of {brief.matches.steps.length} steps of a known {brief.matches.name}
            </strong>
            <div className="steps-seen">
              {brief.matches.steps.map((x) => (
                <span key={x.label} className={`s ${x.seen ? "on" : "off"}`}>
                  <i aria-hidden="true">{x.seen ? "✓" : ""}</i>
                  {x.label}
                  <span className="sr">{x.seen ? " (seen)" : " (not seen)"}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="grid2">
          <div className="card">
            <strong>The details</strong>
            {req.assessment.signals.map((s) => (
              <span className="li" key={s.code}>
                · {s.text}
              </span>
            ))}
          </div>
          <div className="card">
            <strong>What he told Lumi</strong>
            {(brief?.told ?? ["Reading the conversation…"]).map((t, i) => (
              <span className="li" key={i}>
                · {t}
              </span>
            ))}
            {brief && brief.inTheirWords.length > 0 && (
              <>
                <span className="meta" style={{ marginTop: 6 }}>
                  In his words
                </span>
                {brief.inTheirWords.map((t, i) => (
                  <span className="li" key={`w${i}`}>
                    · {t}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
        {brief && (
          <div className={`box ${high ? "tint-red" : "tint-yel"}`}>
            <span className="li" style={{ fontSize: 16 }}>
              <b>Our read:</b> {brief.ourRead}
            </span>
            <span className="src">{brief.source === "ai" ? `Written by Lumi with ${state.ai?.model ?? "Claude"}. Lumi can raise concerns; it can't approve or sign.` : "Written from Lumi's template."}</span>
          </div>
        )}
        <ErrorText msg={err} />
        {actions}
      </Lit>
    </div>
  );
}

/**
 * The guardian's device step.
 * - Live + Speculos (default): the server wakes the Ledger (lib/guardian.ts). Approve = one tap that executes; reject = a signed message.
 * - Live + WebHID (NEXT_PUBLIC_LEDGER_TRANSPORT=webhid): the browser signs the SafeTx (EIP-712), then Dad sends it.
 * - Demo: a simulated screen.
 */
function LedgerScreen({ req, action, note, back }: { req: Req; action: "approve" | "reject" | "invite"; note: string; back: () => void }) {
  const { state, refresh } = useApp();
  const webhid = process.env.NEXT_PUBLIC_LEDGER_TRANSPORT === "webhid";
  const live = webhid && !!req.safeTx && action !== "reject";
  const decision = action === "reject" ? "reject" : "approve";
  const lines: [string, string][] =
    action === "invite"
      ? [
          ["Action", `Become ${state.names.owner}'s guardian`],
          ["Daily limit", `${money(req.kind === "rule" && req.change.kind === "enableProtection" ? req.change.limit : state.account.dailyLimit)} USDC`],
        ]
      : req.kind === "transfer"
        ? [
            ["Action", `${action === "approve" ? "Approve" : "Reject"} ${state.names.owner}'s transfer`],
            ["Amount", fmtAmount(req.amount, symOf(req))],
            ["To", req.to],
          ]
        : [
            ["Action", `${action === "approve" ? "Approve" : "Reject"} rule change`],
            ["Change", req.title],
          ];

  const finish = async (signature?: { signer: string; data: string }) => {
    // Live approval carries Mia's Ledger signature; the server checks it and adds it to the Safe queue.
    if (signature) await api.guardianConfirm(req.id, { signer: signature.signer, signature: signature.data });
    else await api.decide(req.id, { decision, note: decision === "reject" ? note : undefined });
    await refresh();
  };

  const waitingForOwner = state.mode === "live" && action !== "reject" && !req.safeTx && !(req.kind === "rule" && req.change.kind === "allow");
  if (state.mode === "live" && !webhid && !waitingForOwner) return <ServerLedger req={req} decision={decision} note={note} expected={lines} back={back} />;
  if (live) return <RealLedger safeTx={req.safeTx!} expected={lines} onSigned={finish} back={back} />;
  if (waitingForOwner)
    return (
      <div className="stack center fade" style={{ paddingTop: 60 }}>
        <Lumi />
        <h2 className="title">Waiting for {state.names.owner} to sign</h2>
        <p style={{ maxWidth: "42ch" }}>Your Ledger signs the same transaction {state.names.owner} signs in his wallet. As soon as he has, you can approve here.</p>
        <button className="link" type="button" onClick={back}>
          Go back
        </button>
      </div>
    );

  return (
    <div className="stack center fade" style={{ paddingTop: 30 }}>
      <span className="label">{action === "reject" ? "DECLINING NEEDS NO SIGNATURE" : "SIMULATED LEDGER SCREEN"}</span>
      <div className="device">
        {lines.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
      </div>
      <p style={{ maxWidth: "42ch" }}>
        {action === "reject" ? "Declining only records your decision. Nothing moves, and nothing needs your key." : "Check every line on your device. If anything is different from what you expect, reject."}
      </p>
      <button className="btn primary" type="button" onClick={() => finish()}>
        {action === "reject" ? "Confirm: don't send" : "Press both buttons to sign"}
      </button>
      <button className="link" type="button" onClick={back}>
        Go back
      </button>
    </div>
  );
}

/** Speculos: the Ledger is reached by the server. Mia presses here, then checks and approves on the device. */
function ServerLedger({ req, decision, note, expected, back }: { req: Req; decision: "approve" | "reject"; note: string; expected: [string, string][]; back: () => void }) {
  const { state, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const approve = decision === "approve";
  const onChain = approve && !!req.safeTx;

  async function wake() {
    setBusy(true);
    setErr(null);
    try {
      if (approve) await api.guardianApprove(req.id);
      else await api.guardianReject(req.id, { note });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack center fade" style={{ paddingTop: 30 }}>
      <span className="label">SIGN ON YOUR LEDGER · EMULATOR</span>
      <div className="device">
        {expected.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        {req.safeTx && (
          <>
            <span className="k">Safe transaction hash</span>
            <span className="v mono">{req.safeTx.safeTxHash}</span>
          </>
        )}
      </div>
      <p style={{ maxWidth: "46ch" }}>
        {onChain
          ? `Your Ledger will show a transaction to the Safe ${short(state.safe ?? "")}. Approving it adds your signature and sends the transfer in one step (your Ledger address pays the gas).`
          : approve
            ? "Your Ledger will show a message to approve. Nothing moves on-chain."
            : `Your Ledger will show a message starting with "SecondLook: REJECT". Signing it records your decision. Nothing moves.`}
      </p>
      <p className="status" role="status">
        {busy ? (onChain ? "Check the Ledger screen and approve. Then waiting for Sepolia to confirm (about 15 seconds)…" : "Check the Ledger screen and approve…") : "Speculos must be running with the Ethereum app open."}
      </p>
      <ErrorText msg={err} />
      <button className="btn primary" type="button" onClick={wake} disabled={busy}>
        {busy ? "Waiting for your Ledger…" : approve ? "Wake my Ledger to approve" : "Wake my Ledger to reject"}
      </button>
      <button className="link" type="button" onClick={back} disabled={busy}>
        Go back
      </button>
    </div>
  );
}

function RealLedger({ safeTx, expected, onSigned, back }: { safeTx: SafeTxWire; expected: [string, string][]; onSigned: (sig: { signer: string; data: string }) => Promise<void>; back: () => void }) {
  const [status, setStatus] = useState<string>("Plug in your Ledger, unlock it and open the Ethereum app.");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decoded, setDecoded] = useState<string | null>(null);
  const ledger = useRef<import("@/lib/second-look/ledger-client").GuardianLedger | null>(null);
  const tx = safeTx.data as unknown as import("@/lib/safeHash").SafeTxFields;
  const speculos = process.env.NEXT_PUBLIC_LEDGER_TRANSPORT === "speculos";

  useEffect(() => {
    import("@/lib/second-look/ledger-client").then(({ describeSafeTx, safeTxTypedData }) => {
      try {
        safeTxTypedData(safeTx.safeAddress, tx, safeTx.safeTxHash); // throws if the payload was tampered with
        setDecoded(describeSafeTx(tx));
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }, [safeTx, tx]);

  async function sign() {
    setBusy(true);
    setErr(null);
    try {
      const L = await import("@/lib/second-look/ledger-client");
      if (!L.GuardianLedger.supported()) throw new Error("This browser can't reach a Ledger. Use Chrome or Edge on a computer.");
      if (!ledger.current) ledger.current = new L.GuardianLedger();
      if (!ledger.current.connected) {
        setStatus(speculos ? "Connecting to the Ledger emulator…" : "Choose your Ledger in the browser's list…");
        await ledger.current.connect();
      }
      const signer = await ledger.current.getAddress(setStatus);
      const typed = L.safeTxTypedData(safeTx.safeAddress, tx, safeTx.safeTxHash);
      setStatus("Check every line on your Ledger, then hold both buttons to sign");
      const sig = await ledger.current.signTypedData(typed, setStatus);
      setStatus("Signed. Sending your approval…");
      await onSigned({ signer, data: L.packSignature(sig) });
    } catch (e) {
      setErr((e as Error).message);
      setStatus("Nothing was signed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack center fade" style={{ paddingTop: 30 }}>
      <span className="label">SIGN ON YOUR LEDGER{speculos ? " · EMULATOR" : ""}</span>
      <div className="device">
        {expected.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span className="k">{k}</span>
            <span className="v">{v}</span>
          </div>
        ))}
        {decoded && (
          <>
            <span className="k">On-chain call</span>
            <span className="v">{decoded}</span>
          </>
        )}
        <span className="k">Safe transaction hash</span>
        <span className="v mono">{safeTx.safeTxHash}</span>
      </div>
      <p className="status" role="status">
        {status}
      </p>
      <ErrorText msg={err} />
      <button className="btn primary" type="button" onClick={sign} disabled={busy}>
        {busy ? "Waiting for your Ledger…" : "Connect and sign"}
      </button>
      <button className="link" type="button" onClick={back} disabled={busy}>
        Go back
      </button>
    </div>
  );
}
