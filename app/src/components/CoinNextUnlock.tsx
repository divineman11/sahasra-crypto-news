"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UnlockView } from "@/lib/unlockTypes";
import { etDate, fmtPct, fmtTokens, whenText } from "@/lib/unlockFormat";
import { Badge, UnlockBadges } from "./UnlockBadges";

// Coin page: this coin's next unlock (or why we cannot tell).
export function CoinNextUnlock({ ticker }: { ticker: string }) {
  const [view, setView] = useState<UnlockView | null | undefined>(undefined);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/unlocks?coin=${encodeURIComponent(ticker)}`, { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { view?: UnlockView | null } | null) => { if (!ac.signal.aborted) setView(j?.view ?? null); })
      .catch(() => { if (!ac.signal.aborted) setView(null); });
    return () => ac.abort();
  }, [ticker]);

  if (view === undefined) return null;
  if (view === null) return null; // calendar not loaded: the home-page banner and /setup explain it
  const now = Date.now();
  const next = view.upcoming[0];
  const miss = view.missing[0];
  const ann = view.anniversaries[0];
  const cross = view.crosscheck?.items ?? [];
  if (!next && !miss && !ann && cross.length === 0) return null;
  return (
    <div className="mt-3 rounded border border-violet-500/30 bg-slate-900/40 p-2 text-[11px]" data-testid="coin-next-unlock">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">Next unlock </span>
      {next ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <strong className="text-slate-100">{etDate(next.ts)}</strong>
          <span className="text-slate-500">({whenText(next.ts, now)})</span>
          <span>{fmtPct(next.pctCirc)} of circulating</span>
          <span className="text-slate-500">· {fmtTokens(next.tokens)} coins</span>
          <UnlockBadges u={next} />
        </span>
      ) : (
        <span className="text-slate-400">none listed in the next 60 days</span>
      )}
      {!next && miss ? <> <Badge kind="missing" title="A lot is still locked but no tracker lists an unlock date.">DATA MISSING</Badge> <span className="text-slate-500">{miss.lockedPct}% still locked</span></> : null}
      {ann ? <> <Badge kind="anniv" title="Close to a 6 or 12 month mark after launch.">TGE+{ann.months}m</Badge> <span className="text-slate-500">in about {Math.round(ann.days)} days</span></> : null}
      {cross.map((c, i) => (
        <span key={i} className="ml-2 inline-block">
          <Badge kind="cross">{c.kind === "missing" ? "CROSS-CHECK: possibly missing" : "CROSS-CHECK: possibly under-counted"}</Badge>{" "}
          <span className="text-slate-500">{c.date}{c.pct != null ? ` · ${fmtPct(c.pct)}` : ""}</span>
        </span>
      ))}
      <Link href="/unlocks" className="ml-2 text-slate-600 hover:text-cyan-300">all unlocks →</Link>
    </div>
  );
}
