"use client";

import { PURPOSE_OPTIONS, QUESTIONS, type Assessment } from "@/lib/second-look/risk";
import { useEffect, useRef, useState } from "react";
import { ago, api, hoursLeft, isOpen, liveOf, money, short, type AssessResult, type Req, type TransferReq } from "./api";
import { executeApproved, ownerAddress, sendWithinAllowance, signAndPropose } from "@/lib/second-look/owner-client";
import { ErrorText, Lit, Lumi, Pill, useApp } from "./shared";
import { etherscanTxUrl } from "@/lib/config";
import { COMING_SOON, SYMBOLS, balanceOf, fitsDecimals, fmtAmount, symOf, tokenOf, usd, type Sym } from "@/lib/second-look/assets";

type Screen = "home" | "send" | "review" | "chat" | "waiting" | "result" | "settings";
interface Sent {
  amount: number;
  token?: Sym;
  label: string;
  tier: "green" | "yellow" | "red";
}
interface Draft {
  to: string;
  label: string;
  amount: string;
  /** USDC if not set */
  token?: Sym;
  pasted?: boolean;
  mode: "contact" | "new";
  /** Behaviour on the send screen, measured here on the device. */
  amountEdits?: number;
  dwellMs?: number;
}

const SCAM = "0x7a3f9e21b04d5c88a6f13e27d90b4f61a52ec91e";

export function Dad() {
  const { state } = useApp();
  const [screen, setScreen] = useState<Screen>("home");
  const [draft, setDraft] = useState<Draft>({ to: "", label: "", amount: "", mode: "contact" });
  /** Set when a green or yellow transfer went straight out (no request involved). */
  const [sent, setSent] = useState<Sent | null>(null);
  const open = state.open;

  // Follow the shared request: when Mia decides or it expires, show the result.
  useEffect(() => {
    if ((screen === "chat" || screen === "waiting") && !isOpen(open)) setScreen("result");
    if (screen === "chat" && open?.status === "pending") setScreen("waiting");
  }, [open, screen]);

  if (!state.account.guardianActive) return <Setup />;
  const go = (s: Screen) => {
    if (s === "chat" || s === "waiting" || s === "send") setSent(null);
    setScreen(s);
  };
  switch (screen) {
    case "send":
      return <Send draft={draft} setDraft={setDraft} go={go} />;
    case "review":
      return <Review draft={draft} go={go} onSent={setSent} />;
    case "chat":
      return open?.kind === "transfer" && open.status === "chat" ? <Chat req={open} go={go} /> : <Home go={go} />;
    case "waiting":
      return isOpen(open) ? <Waiting go={go} /> : <Result go={go} sent={null} />;
    case "result":
      return <Result go={go} sent={sent} />;
    case "settings":
      return <Settings go={go} />;
    default:
      return <Home go={go} />;
  }
}

function Head({ back, go }: { back?: Screen; go?: (s: Screen) => void }) {
  const { state } = useApp();
  return (
    <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
      {back && go ? (
        <button className="link" type="button" onClick={() => go(back)} style={{ alignSelf: "auto" }}>
          ‹ Back
        </button>
      ) : (
        <span className="meta">Second Look</span>
      )}
      <span className="meta">{state.account.guardianActive ? `Guardian: ${state.names.guardian}` : "Not protected yet"}</span>
    </div>
  );
}

/** Daily limit range (USD value). The server enforces the same bounds. */
const LIMIT_MIN = 0;
const LIMIT_MAX = 5000;

export function LimitControl({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const pct = Math.min(100, Math.max(0, ((value - LIMIT_MIN) / (LIMIT_MAX - LIMIT_MIN)) * 100));
  return (
    <div className="limit">
      <div className="limit-top">
        <label className="sr" htmlFor="limitAmt">
          Daily limit in USDC
        </label>
        <input id="limitAmt" className="limit-amt" inputMode="numeric" value={value} onChange={(e) => onChange(Math.min(LIMIT_MAX, Number(e.target.value.replace(/[^0-9]/g, "")) || 0))} />
        <span className="limit-unit">USDC a day</span>
      </div>
      <input
        className="slider"
        type="range"
        min={LIMIT_MIN}
        max={LIMIT_MAX}
        step={50}
        value={Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, value))}
        style={{ ["--pct" as string]: `${pct}%` }}
        aria-label="Daily limit"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="ticks">
        <span>{LIMIT_MIN.toLocaleString("en-US")}</span>
        <span>{LIMIT_MAX.toLocaleString("en-US")}</span>
      </div>
      <div className="row">
        {[200, 1000, 5000].map((v) => (
          <button key={v} className="chip" type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {v} {v === 200 ? "· typical" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function Setup() {
  const { state, refresh } = useApp();
  const g = state.names.guardian;
  const [step, setStep] = useState(1);
  const [limit, setLimit] = useState(200);
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invited = isOpen(state.open) && state.open.kind === "rule" && state.open.change.kind === "enableProtection";
  const bars = (n: number) => (
    <div className="steps" aria-label={`Step ${n} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </div>
  );

  if (invited)
    return (
      <div className="stack center fade">
        {bars(4)}
        <div className="ring">
          <b>…</b>
          <span className="meta">waiting</span>
        </div>
        <h1 className="title">Waiting for {g} to confirm on her Ledger</h1>
        <p>We sent the invite. Protection turns on as soon as she confirms.</p>
      </div>
    );
  if (step === 1)
    return (
      <div className="stack fade">
        {bars(1)}
        <div style={{ alignSelf: "center" }}>
          <Lumi />
        </div>
        <h1 className="title">A second look for your bigger transfers</h1>
        <p>Pick someone you trust. Everyday payments stay instant. Big or unusual ones wait until they confirm on their Ledger.</p>
        <button className="btn primary" type="button" onClick={() => setStep(2)}>
          Get started
        </button>
      </div>
    );
  if (step === 2)
    return (
      <div className="stack fade">
        {bars(2)}
        <h1 className="title">Choose someone you trust</h1>
        <p>Your guardian is a second pair of eyes. They can never move your money, only approve or decline.</p>
        <label className="field">
          Guardian's name
          <input type="text" defaultValue={g} />
        </label>
        <button className="btn primary" type="button" onClick={() => setStep(3)}>
          Continue
        </button>
      </div>
    );
  return (
    <div className="stack fade">
      {bars(3)}
      <h1 className="title">Set your daily limit</h1>
      <p>Up to this amount each day, you send as normal. Anything above it needs {g}.</p>
      <LimitControl value={limit} onChange={setLimit} />
      <div className="box tint-yel">
        <strong style={{ fontSize: 15 }}>Changing or removing your guardian, or raising this limit, also needs {g}'s approval.</strong>
        <span className="li">This protects you if someone ever pressures you to turn protection off. Lowering the limit works right away.</span>
      </div>
      <label className="row" style={{ alignItems: "center", gap: 12, fontSize: 16 }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 22, height: 22, accentColor: "#5A3E2B" }} /> I understand how this works
      </label>
      <ErrorText msg={err} />
      <button
        className="btn primary"
        type="button"
        onClick={async () => {
          if (limit < LIMIT_MIN || limit > LIMIT_MAX) return setErr(`Choose a daily limit between ${LIMIT_MIN} and ${LIMIT_MAX.toLocaleString("en-US")} USDC.`);
          if (!agree) return setErr("Tick the box to continue.");
          try {
            await api.rule({ kind: "enableProtection", limit });
            await refresh();
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        Send invite to {g}
      </button>
    </div>
  );
}

function Home({ go }: { go: (s: Screen) => void }) {
  const { state } = useApp();
  const { account, names, open } = state;
  const spent = Math.max(0, account.dailyLimit - state.remainingToday);
  const pct = account.dailyLimit > 0 ? Math.min(100, (spent / account.dailyLimit) * 100) : 100;
  return (
    <div className="stack fade">
      <Head />
      <div>
        <span className="meta">Your balance</span>
        <div className="big">
          {money(account.balance)} <span>USDC</span>
        </div>
        <span className="meta">
          {SYMBOLS.filter((t) => t !== "USDC" && (t === "ETH" || balanceOf(account, t) > 0))
            .map((t) => fmtAmount(balanceOf(account, t), t))
            .join(" · ")}
        </span>
      </div>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong style={{ fontSize: 15 }}>Protected by {names.guardian}</strong>
          <span className="meta">
            {money(spent)} / {money(account.dailyLimit)} today
          </span>
        </div>
        <div className="meter" role="img" aria-label={`${money(spent)} of ${money(account.dailyLimit)} USDC used today`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="meta">Transfers above your daily limit wait for {names.guardian}.</span>
      </div>
      {isOpen(open) && (
        <button className="box tint-yel" type="button" onClick={() => go(open.status === "chat" ? "chat" : "waiting")} style={{ border: "none", textAlign: "left", color: "inherit", font: "inherit" }}>
          <strong>{open.kind === "transfer" && open.status === "chat" ? (open.conversation.checkingFirst ? "You're checking first" : "Your chat with Lumi") : `Waiting on ${names.guardian}`}</strong>
          <span className="li">
            {open.kind === "transfer" ? `${fmtAmount(open.amount, symOf(open))} to ${open.label}` : open.title}
            {open.kind === "transfer" && open.status === "chat" ? ` · saved for ${hoursLeft(open, state.now)}h, nothing moves` : ""} · tap to {open.status === "chat" ? "continue" : "view"}
          </span>
        </button>
      )}
      {state.mode === "live" && state.latest?.status === "approved" && state.latest.safeTx && !state.latest.safeTx.executedTxHash && (
        <button className="box tint-grn" type="button" onClick={() => go("result")} style={{ border: "none", textAlign: "left", color: "inherit", font: "inherit" }}>
          <strong>{names.guardian} approved</strong>
          <span className="li">Both confirmations are in · tap to send it</span>
        </button>
      )}
      <div className="row">
        <button className="btn primary" type="button" onClick={() => go("send")} disabled={isOpen(open)}>
          Send money
        </button>
        <button className="btn" type="button" onClick={() => go("settings")}>
          Settings
        </button>
      </div>
      <div className="card">
        <strong style={{ fontSize: 15 }}>Recent activity</strong>
        <div className="list">
          {account.history.slice(0, 4).map((h, i) => (
            <div className="item" key={i}>
              <span>
                {h.label}
                <br />
                <span className="meta">{ago(h.ts, state.now)}</span>
              </span>
              <b>−{h.token ? fmtAmount(h.tokenAmount ?? h.amount, h.token) : money(h.amount)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Send({ draft, setDraft, go }: { draft: Draft; setDraft: (d: Draft) => void; go: (s: Screen) => void }) {
  const { state } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const token = symOf(draft);
  const balance = balanceOf(state.account, token);
  // Behaviour signals, measured on the device: time on this screen, and how often the amount was changed.
  const opened = useRef(Date.now());
  const lastAmount = useRef<string | null>(draft.amount || null);
  return (
    <div className="stack fade">
      <Head back="home" go={go} />
      <h1 className="title">Send money</h1>
      <span className="field" style={{ margin: 0 }}>
        To
      </span>
      <div className="row">
        {state.account.allowlist.map((c) => (
          <button key={c.addr} className="chip" type="button" aria-pressed={draft.mode === "contact" && draft.to === c.addr} onClick={() => set({ mode: "contact", to: c.addr, label: c.label, pasted: false })}>
            {c.label}
          </button>
        ))}
        <button className="chip" type="button" aria-pressed={draft.mode === "new"} onClick={() => set({ mode: "new", to: "", label: "", pasted: true })}>
          New address
        </button>
      </div>
      {draft.mode === "new" && (
        <>
          <label className="field">
            Paste the address
            <input type="text" placeholder="0x…" value={draft.to} autoComplete="off" onChange={(e) => set({ to: e.target.value.trim() })} />
          </label>
          <label className="field">
            Who is this?
            <input type="text" placeholder="Name or company" value={draft.label} onChange={(e) => set({ label: e.target.value })} />
          </label>
        </>
      )}
      <label className="field">
        Token
        <select value={token} onChange={(e) => set({ token: e.target.value })}>
          {SYMBOLS.map((t) => (
            <option key={t} value={t}>
              {t} · {tokenOf(t).name} · balance {fmtAmount(balanceOf(state.account, t), t)}
            </option>
          ))}
          <optgroup label="Coming soon">
            {COMING_SOON.map((t) => (
              <option key={t.symbol} value={t.symbol} disabled>
                {t.symbol} · {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="field">
        Amount ({token})
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={draft.amount}
          onChange={(e) => set({ amount: e.target.value })}
          onBlur={() => {
            const v = draft.amount.trim();
            if (v && lastAmount.current !== null && v !== lastAmount.current) set({ amountEdits: (draft.amountEdits ?? 0) + 1 });
            if (v) lastAmount.current = v;
          }}
        />
      </label>
      <ErrorText msg={err} />
      <button
        className="btn primary"
        type="button"
        onClick={() => {
          const amt = Number(draft.amount.replace(/,/g, ""));
          if (!draft.to) return setErr("Choose who you're paying, or paste a new address.");
          if (!/^0x[0-9a-fA-F]{40}$/.test(draft.to)) return setErr("That address doesn't look right. It should start with 0x and have 42 characters.");
          if (!(amt > 0)) return setErr("Enter an amount above 0.");
          if (!fitsDecimals(amt, token)) return setErr(`${token} allows at most ${tokenOf(token).decimals} decimals.`);
          if (amt > balance) return setErr(`That's more than your balance of ${fmtAmount(balance, token)}.`);
          setDraft({ ...draft, dwellMs: (draft.dwellMs ?? 0) + (Date.now() - opened.current) });
          go("review");
        }}
      >
        Review
      </button>
      <div className="box tint-yel">
        <span className="meta" style={{ color: "var(--walnut)" }}>
          Demo shortcuts
        </span>
        <div className="row">
          <button className="btn sm" type="button" onClick={() => setDraft({ mode: "contact", to: state.account.allowlist[0]!.addr, label: state.account.allowlist[0]!.label, amount: "40" })}>
            Grocery, 40
          </button>
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              const m = state.account.allowlist.find((c) => c.label === state.names.guardian) ?? state.account.allowlist.at(-1)!;
              setDraft({ mode: "contact", to: m.addr, label: m.label, amount: "800" });
            }}
          >
            Trusted, 800
          </button>
          <button className="btn sm" type="button" onClick={() => setDraft({ mode: "new", to: "0x2f8e61c0d94b37a5e18c2f60b9d4a73e05c1f8d2", label: "Piano teacher", amount: "80", pasted: true })}>
            New contact, 80
          </button>
          <button className="btn sm" type="button" onClick={() => setDraft({ mode: "new", to: SCAM, label: '"Trading platform"', amount: "5000", pasted: true, amountEdits: 3 })}>
            "Platform", 5,000
          </button>
        </div>
      </div>
    </div>
  );
}

function Review({ draft, go, onSent }: { draft: Draft; go: (s: Screen) => void; onSent: (s: Sent | null) => void }) {
  const { state, refresh } = useApp();
  const g = state.names.guardian;
  const amount = Number(draft.amount.replace(/,/g, ""));
  const token = symOf(draft);
  const [res, setRes] = useState<AssessResult | null>(null);
  const a: Assessment | null = res?.assessment ?? null;
  const live = state.mode === "live";
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = state.account.allowlist.some((c) => c.addr.toLowerCase() === draft.to.toLowerCase());

  const { safe, owner: setupOwner } = liveOf(state);
  useEffect(() => {
    (async () => {
      const owner = live ? await ownerAddress({ safe, owner: setupOwner }) : undefined;
      setRes(await api.assess({ to: draft.to, amount, token, pasted: draft.pasted, owner, amountEdits: draft.amountEdits, dwellMs: draft.dwellMs }));
    })().catch((e: Error) => setErr(e.message));
  }, [draft.to, amount, token, draft.pasted, draft.amountEdits, draft.dwellMs, live, safe, setupOwner]);

  if (!a) return <div className="stack">{err ? <ErrorText msg={err} /> : <span className="meta">Checking…</span>}</div>;
  const tone = a.tier === "red" ? "red" : a.tier === "yellow" ? "yellow" : "green";
  const noAllowance = res!.route === "guardian" && a.tier !== "red";
  const lead = noAllowance
    ? `This looks normal, but the daily limit isn't turned on for this account yet, so ${g} confirms it on her Ledger.`
    : a.lightPath
      ? `This is above your daily limit, so ${g} confirms. ${draft.label || "This contact"} is a trusted contact, so no questions needed.`
      : a.tier === "red"
        ? `This one needs a second look from ${g} before it goes out.`
        : a.tier === "yellow"
          ? `Within your limit, so it goes out now. Because it's a new address, ${g} gets a heads-up. No approval needed.`
          : "Everyday payment, within your daily limit.";

  async function sign() {
    setBusy(true);
    try {
      const base = { to: draft.to, amount, token, label: draft.label, pasted: draft.pasted, amountEdits: draft.amountEdits, dwellMs: draft.dwellMs };
      if (live && res!.route === "allowance") {
        // Everyday transfer: Dad's MetaMask sends it through the on-chain daily allowance. No Mia.
        const txHash = await sendWithinAllowance(liveOf(state), draft.to, amount);
        await api.transfer({ ...base, txHash, route: "allowance" });
        onSent({ amount, token, label: draft.label || "New contact", tier: a!.tier });
        await refresh();
        return go("result");
      }
      const r = await api.transfer({ ...base, route: res!.route });
      if (live && r.request && r.request.status === "pending") {
        // Low risk but no allowance yet: straight to Mia, signed in MetaMask first.
        await signAndPropose(liveOf(state), r.request as Req & { id: string });
        await refresh();
        return go("waiting");
      }
      onSent(r.request ? null : { amount, token, label: draft.label || "New contact", tier: r.assessment.tier });
      await refresh();
      go(r.request ? (r.request.status === "chat" ? "chat" : "waiting") : "result");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack fade">
      <Head back="send" go={go} />
      <h1 className="title">Check before sending</h1>
      <div className="card">
        <span className="meta">You're sending</span>
        <span className="big">
          {fmtAmount(amount, token).split(" ")[0]} <span>{token}</span>
        </span>
        {token !== "USDC" && <span className="meta">≈ {money(usd(amount, token))} USD for the daily limit and risk check</span>}
        <strong style={{ fontSize: 15 }}>
          To {draft.label || "New contact"}
          {known ? "" : " · new address"}
        </strong>
        <span className="meta">{short(draft.to)}</span>
      </div>
      <div className={`box ${a.tier === "red" ? "tint-red" : a.tier === "yellow" ? "tint-yel" : "tint-grn"}`}>
        <Pill tone={tone}>{a.tier === "red" ? `Needs ${g}` : noAllowance ? `${g} confirms` : a.tier === "yellow" ? `${g} will be told` : "Looks normal"}</Pill>
        <span className="li" style={{ fontSize: 16 }}>
          {lead}
        </span>
        {a.signals.map((s) => (
          <span className="li" key={s.code}>
            · {s.hard ? <b>{s.text}</b> : s.text}
          </span>
        ))}
      </div>
      <ErrorText msg={err} />
      <button className="btn primary" type="button" onClick={sign} disabled={busy}>
        {a.tier === "red" || noAllowance ? `Sign and ask ${g}` : "Sign and send"}
      </button>
      <button className="btn" type="button" onClick={() => go("home")}>
        Cancel
      </button>
    </div>
  );
}

function Chat({ req, go }: { req: TransferReq; go: (s: Screen) => void }) {
  const { state, refresh } = useApp();
  const g = state.names.guardian;
  const c = req.conversation;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const options = c.done || !c.asking ? [] : c.asking === "purpose" ? PURPOSE_OPTIONS.map((o) => o.label) : QUESTIONS[c.asking].options.map((o) => o.label);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [c.lines.length, busy]);

  async function act(fn: () => Promise<unknown>, after?: Screen) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
      if (after) go(after);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const send = (body: { text?: string; option?: number }) => act(async () => {
    await api.turn(req.id, body);
    setText("");
  });
  const cancel = () => act(() => api.cancel(req.id), "result");

  return (
    <div className="chat">
      <Lit>
        <div className="head-c">
          <strong style={{ fontSize: 19 }}>A quick chat with Lumi</strong>
          <div className="meta">Your money hasn't moved · {g} has been told</div>
        </div>
        {c.lines.map((l, i) => (
          <div key={i} className={`bubble ${l.from === "lumi" ? "lumi" : "me"}`}>
            {l.text}
          </div>
        ))}
        {busy && <span className="typing">Lumi is thinking…</span>}
        <div ref={end} />
        {!c.done ? (
          <>
            <div className="answers">
              {options.map((label, i) => (
                <button key={label} className="chip" type="button" disabled={busy} onClick={() => send({ option: i })}>
                  {label}
                </button>
              ))}
            </div>
            <form
              className="compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send({ text });
              }}
            >
              <label className="sr" htmlFor="answer">
                Your answer
              </label>
              <input id="answer" placeholder="Or tell Lumi in your own words…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} maxLength={600} />
              <button className="btn primary sm" type="submit" disabled={busy || !text.trim()}>
                Send
              </button>
            </form>
            <ErrorText msg={err} />
            <button className="link" type="button" onClick={cancel}>
              Cancel this transfer
            </button>
          </>
        ) : (
          <>
            {c.selfCheck && (
              <div className="box tint-yel">
                <strong style={{ fontSize: 15 }}>Check it yourself</strong>
                <span className="li">{c.selfCheck}</span>
              </div>
            )}
            <div className="exits">
              <button className="btn primary" type="button" disabled={busy || !!c.callRequested} onClick={() => act(() => api.callGuardian(req.id))}>
                {c.callRequested ? `${g} knows you'd like to talk` : `Call ${g} now`}
              </button>
              {!c.checkingFirst && (
                <button className="btn" type="button" disabled={busy} onClick={() => act(() => api.checkFirst(req.id), "home")}>
                  {"I'll check first and come back"}
                </button>
              )}
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() =>
                  // Live: Dad signs the Safe transaction in MetaMask; demo: hand it straight to Mia.
                  act(() => (state.mode === "live" ? signAndPropose(liveOf(state), req) : api.submit(req.id)), "waiting")
                }
              >
                Send to {g} to confirm
              </button>
              <button className="link" type="button" disabled={busy} onClick={cancel}>
                Cancel
              </button>
            </div>
            <ErrorText msg={err} />
          </>
        )}
        <span className="src">{c.source === "ai" ? `Lumi is reading your answers with ${state.ai?.model ?? "Claude"}` : "Lumi is using its scripted questions"}</span>
      </Lit>
    </div>
  );
}

function Waiting({ go }: { go: (s: Screen) => void }) {
  const { state, refresh } = useApp();
  const r = state.open!;
  const g = state.names.guardian;
  const [err, setErr] = useState<string | null>(null);
  const needsOwnerSig = state.mode === "live" && !r.safeTx;
  return (
    <div className="stack center fade">
      <Head back="home" go={go} />
      <div className="ring">
        <b>{hoursLeft(r, state.now)}h</b>
        <span className="meta">left</span>
      </div>
      <h1 className="title">Waiting for {g}'s confirmation</h1>
      <p>
        {r.kind === "transfer" ? `Your ${fmtAmount(r.amount, symOf(r))} is on hold and safe.` : `${r.title} is on hold.`} If {g} doesn't respond within 24 hours, it's cancelled and nothing changes.
      </p>
      <p className="meta">
        {g} has been reminded {Math.max(1, r.remindersSent ?? 1)} of 3 times.
      </p>
      {needsOwnerSig && (
        <>
          <button
            className="btn primary"
            type="button"
            onClick={() => signAndPropose(liveOf(state), r).then(refresh, (e: Error) => setErr(e.message))}
          >
            Sign in MetaMask to send it to {g}
          </button>
          <ErrorText msg={err} />
        </>
      )}
      {r.kind === "transfer" && (
        <p className="meta" style={{ fontSize: 15 }}>
          If someone is telling you this has to happen right now, that's worth a pause.
        </p>
      )}
      <div className="row" style={{ width: "100%" }}>
        <button className="btn primary" type="button">
          Call {g}
        </button>
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await api.cancel(r.id);
            await refresh();
            go("result");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Result({ go, sent }: { go: (s: Screen) => void; sent: Sent | null }) {
  const { state } = useApp();
  const r = state.latest;
  const g = state.names.guardian;
  const back = (
    <button className="btn" type="button" onClick={() => go("home")} style={{ width: "100%" }}>
      Back to wallet
    </button>
  );
  if (sent || !r || isOpen(r))
    return (
      <div className="stack center fade" style={{ paddingTop: 20 }}>
        <Lumi pose="calm" />
        <h1 className="title">Sent</h1>
        <p>
          {sent ? `${fmtAmount(sent.amount, symOf(sent))} to ${sent.label}.` : "Your transfer went out."}
          {sent?.tier === "yellow" ? ` ${g} got a heads-up because it's a new address.` : ""}
        </p>
        {back}
      </div>
    );
  const what = r.kind === "transfer" ? `${fmtAmount(r.amount, symOf(r))} to ${r.label}` : r.title;
  if (r.status === "rejected")
    return (
      <div className="stack fade">
        <div className="box tint-red" style={{ borderRadius: "var(--r-lg)", padding: 20 }}>
          <h1 className="title">{r.kind === "transfer" ? "This transfer didn't go through" : "This change wasn't made"}</h1>
          <p>
            {g} reviewed it and decided to hold off.{r.kind === "transfer" ? ` Your ${fmtAmount(r.amount, symOf(r))} is safe.` : ""}
          </p>
        </div>
        {r.kind === "transfer" && <p>You didn't do anything wrong. These situations are designed by professionals to feel real, and they fool careful people every day.</p>}
        {r.note?.trim() && (
          <div className="card">
            <span className="meta">A note from {g}</span>
            <strong style={{ fontSize: 18, lineHeight: "26px" }}>"{r.note}"</strong>
          </div>
        )}
        {r.kind === "transfer" && (
          <>
            <span className="li">· If anyone asks you to pay a tax, fee or deposit to withdraw your money, the platform isn't real.</span>
            <span className="li">· Be careful of anyone offering to recover lost money. It's a common second scam.</span>
            <span className="li">
              · You can report it at{" "}
              <a href="https://www.ic3.gov" target="_blank" rel="noopener" style={{ color: "inherit" }}>
                ic3.gov
              </a>
              .
            </span>
          </>
        )}
        <div className="row">
          <button className="btn primary" type="button">
            Call {g}
          </button>
          <button className="btn" type="button" onClick={() => go("home")}>
            Back to wallet
          </button>
        </div>
      </div>
    );
  if (state.mode === "live" && r.status === "approved" && r.safeTx && !r.safeTx.executedTxHash) return <SendNow req={r} go={go} />;
  const body =
    r.status === "approved"
      ? { t: "Both confirmations received", p: `${g} approved on her Ledger. ${r.kind === "transfer" ? `${what} was sent. The address is now in your contacts.` : `${what} is now in effect.`}` }
      : r.status === "cancelled"
        ? { t: "You stopped it yourself", p: `Nothing was sent. If you'd like to talk it through, ${g} is one call away.` }
        : r.status === "expired"
          ? r.expiredWhile === "chat"
            ? { t: "This request expired", p: `You didn't send it on to ${g}, so after 24 hours it was cancelled. Your funds never left your account. You can start it again anytime.` }
            : { t: "This request expired", p: `${g} didn't respond in time, so it was cancelled. Your funds never left your account. You can start it again anytime.` }
          : { t: "Sent", p: what };
  return (
    <div className="stack center fade" style={{ paddingTop: 20 }}>
      <Lumi pose={r.status === "expired" ? "rest" : "calm"} />
      <h1 className="title">{body.t}</h1>
      <p>{body.p}</p>
      {r.safeTx?.executedTxHash && (
        <a className="meta mono" href={etherscanTxUrl(r.safeTx.executedTxHash)} target="_blank" rel="noreferrer">
          On-chain: {short(r.safeTx.executedTxHash)} (Etherscan)
        </a>
      )}
      {back}
    </div>
  );
}

/** Live mode: Mia has signed on her Ledger. Dad sends the Safe transaction (both signatures attached) and pays the gas. */
function SendNow({ req, go }: { req: Req; go: (s: Screen) => void }) {
  const { state, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const what = req.kind === "transfer" ? `${fmtAmount(req.amount, symOf(req))} to ${req.label}` : req.title;
  return (
    <div className="stack center fade" style={{ paddingTop: 20 }}>
      <Lumi pose="calm" />
      <h1 className="title">{state.names.guardian} approved on her Ledger</h1>
      <p>Both confirmations are in. Send {what} now.</p>
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        style={{ width: "100%" }}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await executeApproved(liveOf(state), req.id);
            await refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Confirm in MetaMask…" : "Send now"}
      </button>
      <ErrorText msg={err} />
      <button className="btn" type="button" onClick={() => go("home")} style={{ width: "100%" }}>
        Later
      </button>
    </div>
  );
}

function Settings({ go }: { go: (s: Screen) => void }) {
  const { state, refresh } = useApp();
  const g = state.names.guardian;
  const cur = state.account.dailyLimit;
  const [limit, setLimit] = useState(cur);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const pending = isOpen(state.open);
  const run = async (fn: () => Promise<{ applied: boolean; request: Req | null }>) => {
    setErr(null);
    try {
      const r = await fn();
      // Live: a change that needs Mia is a Safe transaction Dad signs first.
      if (state.mode === "live" && r.request && r.request.kind === "rule" && r.request.change.kind !== "allow") await signAndPropose(liveOf(state), r.request);
      await refresh();
      if (!r.applied) go("waiting");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="stack fade">
      <Head back="home" go={go} />
      <h1 className="title">Settings</h1>
      <div className="card">
        <strong>Daily limit</strong>
        <span className="meta">
          Now {money(cur)} USDC a day. Raising it needs {g}. Lowering it works right away.
        </span>
        <LimitControl value={limit} onChange={setLimit} />
        <button className="btn sm primary" type="button" disabled={limit === cur || pending || limit < LIMIT_MIN || limit > LIMIT_MAX} onClick={() => run(() => api.rule({ kind: "limit", from: cur, to: limit }))}>
          {limit === cur ? "This is your current limit" : limit < cur ? `Lower to ${money(limit)} USDC now` : `Ask ${g} to raise it to ${money(limit)} USDC`}
        </button>
      </div>
      {state.mode === "live" && (
        <div className="card">
          <strong>On-chain daily limit</strong>
          <span className="meta">
            Turn on the Safe's daily allowance so everyday payments under {money(cur)} USDC go out without {g}. Turning it on needs {g}'s Ledger once.
          </span>
          <button className="btn sm" type="button" disabled={pending} onClick={() => run(() => api.rule({ kind: "enableProtection", limit: cur }))}>
            Ask {g} to turn it on
          </button>
        </div>
      )}
      <div className="card">
        <strong>Trusted contacts</strong>
        <div className="list">
          {state.account.allowlist.map((c) => (
            <div className="item" key={c.addr}>
              <span>{c.label}</span>
              <span className="meta">{short(c.addr)}</span>
            </div>
          ))}
        </div>
        <label className="field">
          Add an address
          <input type="text" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        </label>
        <label className="field">
          Name
          <input type="text" placeholder="Who is this?" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button
          className="btn sm"
          type="button"
          disabled={pending}
          onClick={() => {
            if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return setErr("That address doesn't look right. It should start with 0x and have 42 characters.");
            run(() => api.rule({ kind: "allow", addr, label: label || "New contact" }));
          }}
        >
          Ask {g} to add it
        </button>
      </div>
      <div className="card">
        <strong>Guardian: {g}</strong>
        <span className="meta">Removing your guardian needs her approval, so nobody can pressure you into turning protection off.</span>
        <button className="btn sm reject" type="button" disabled={pending} onClick={() => run(() => api.rule({ kind: "removeGuardian" }))}>
          Remove {g} as guardian
        </button>
      </div>
      <ErrorText msg={err} />
      {pending && <p className="meta">One request is already waiting on {g}.</p>}
    </div>
  );
}
