"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { State } from "./api";

export interface AppCtx {
  state: State;
  /** Re-fetch shared state after an action. */
  refresh: () => Promise<void>;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("No app state");
  return c;
}

export function Lumi({ pose = "rest", size = 132 }: { pose?: "rest" | "looking" | "calm"; size?: number }) {
  const src = pose === "looking" ? "/lumi-looking.svg" : pose === "calm" ? "/lumi-calm.svg" : "/lumi.svg";
  const alt = pose === "looking" ? "Lumi, light on" : pose === "calm" ? "Lumi, calm" : "Lumi resting";
  return <img className="mascot" src={src} alt={alt} style={{ width: size, height: size * 0.92 }} />;
}

/** The lamp moment: Lumi lowers over the content and its beam falls on it. */
export function Lit({ children }: { children: ReactNode }) {
  return (
    <div className="lit fade">
      <img className="lamp" src="/lumi-down.svg" alt="Lumi, light on" />
      {children}
    </div>
  );
}

export function Pill({ tone, children }: { tone: "red" | "yellow" | "green"; children: ReactNode }) {
  return (
    <span className={`pill ${tone === "green" ? "g" : tone === "yellow" ? "y" : ""}`}>
      <span className="d" />
      {children}
    </span>
  );
}

export function ErrorText({ msg }: { msg: string | null }) {
  return msg ? (
    <p className="err" role="alert">
      {msg}
    </p>
  ) : null;
}
