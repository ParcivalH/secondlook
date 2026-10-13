"use client";

import { GROUP_LABELS, type RiskScore, type ScoreGroup } from "@/lib/second-look/risk";

const BAND = {
  low: { label: "Low risk", fill: "#6B8556", tint: "#E4EAD9" },
  elevated: { label: "Unusual", fill: "#D4A04A", tint: "#F4E6C8" },
  high: { label: "High risk", fill: "#9E3A2B", tint: "#F1DED8" },
} as const;
const CAPS: Record<ScoreGroup, number> = { transfer: 30, recipient: 40, conversation: 60 };

/** Point on the gauge arc for a 0–100 value (left to right over the top). */
function pt(v: number, r: number) {
  const a = Math.PI * (1 - v / 100);
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)] as const;
}
function arc(from: number, to: number, r: number) {
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function Gauge({ score, band }: { score: number; band: RiskScore["band"] }) {
  const b = BAND[band];
  return (
    <svg viewBox="0 0 200 118" width="220" height="130" role="img" aria-label={`Risk score ${score} out of 100, ${b.label}`}>
      <path d={arc(0, 39.5, 80)} stroke={BAND.low.tint} strokeWidth="14" fill="none" />
      <path d={arc(40.5, 69.5, 80)} stroke={BAND.elevated.tint} strokeWidth="14" fill="none" />
      <path d={arc(70.5, 100, 80)} stroke={BAND.high.tint} strokeWidth="14" fill="none" />
      {score > 0 && <path d={arc(0, Math.max(1, score), 80)} stroke={b.fill} strokeWidth="14" fill="none" strokeLinecap="round" />}
      <text x="100" y="92" textAnchor="middle" fontFamily="var(--display)" fontWeight="600" fontSize="46" fill="#2B211A">
        {score}
      </text>
      <text x="100" y="112" textAnchor="middle" fontSize="13" fontWeight="500" fill="#786A5C">
        out of 100
      </text>
    </svg>
  );
}

function Trail({ trail }: { trail: number[] }) {
  if (trail.length < 2) return null;
  const w = 160, h = 36;
  const pts = trail.map((v, i) => `${((i / (trail.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(" ");
  const last = trail.at(-1)!;
  return (
    <div className="trail">
      <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} width={w + 8} height={h + 8} aria-hidden="true">
        <polyline points={pts} fill="none" stroke="#2B211A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {trail.map((v, i) => (
          <circle key={i} cx={(i / (trail.length - 1)) * w} cy={h - (v / 100) * h} r={i === trail.length - 1 ? 4 : 2.5} fill="#2B211A" />
        ))}
      </svg>
      <span className="meta">
        {trail[0]} when the transfer was flagged{last !== trail[0] ? ` → ${last} after his answers` : ""}
      </span>
    </div>
  );
}

/** The guardian's risk score: a gauge, what moved it, and how it changed during the chat. */
export function RiskScoreCard({ score, trail, live }: { score: RiskScore; trail: number[]; live: boolean }) {
  const b = BAND[score.band];
  const groups = (["transfer", "recipient", "conversation"] as ScoreGroup[]).filter((g) => g !== "conversation" || score.groups.conversation > 0 || live);
  return (
    <div className="card score">
      <div className="score-top">
        <div className="score-gauge">
          <Gauge score={score.score} band={score.band} />
          <span className="pill" style={{ background: b.tint, alignSelf: "center" }}>
            <span className="d" style={{ background: b.fill }} />
            {b.label}
          </span>
        </div>
        <div className="score-bars">
          <strong>What's driving it</strong>
          {groups.map((g) => {
            const items = score.items.filter((i) => i.group === g);
            return (
              <div key={g} className="sbar">
                <div className="sbar-head">
                  <span>{GROUP_LABELS[g]}</span>
                  <span className="meta">+{score.groups[g]}</span>
                </div>
                <div className="meter" role="img" aria-label={`${GROUP_LABELS[g]}: ${score.groups[g]} of ${CAPS[g]} points`}>
                  <i style={{ width: `${(score.groups[g] / CAPS[g]) * 100}%` }} />
                </div>
                <div className="chips">
                  {items.length ? (
                    items.map((it, k) => (
                      <span key={k} className="why">
                        {it.label} <b>+{it.points}</b>
                      </span>
                    ))
                  ) : (
                    <span className="meta">{g === "conversation" ? "Lumi is still talking with him…" : "Nothing unusual"}</span>
                  )}
                </div>
              </div>
            );
          })}
          {score.floor && <span className="meta">Raised to {score.floor.value}: {score.floor.reason.toLowerCase()}.</span>}
        </div>
      </div>
      <Trail trail={trail} />
      <span className="src">The score is calculated from fixed rules and his answers. Lumi can't set it or lower it.</span>
    </div>
  );
}
