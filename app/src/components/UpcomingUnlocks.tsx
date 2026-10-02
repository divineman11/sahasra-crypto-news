"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UnlockView } from "@/lib/unlockTypes";
import { etDate, fmtPct, whenText } from "@/lib/unlockFormat";
import { UnlockBadges } from "./UnlockBadges";

// Right sidebar: the next unlocks (shocks first within the next 14 days).
export function UpcomingUnlocks() {
  const [view, setView] = useState<UnlockView | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      fetch("/api/unlocks", { cache: "no-store", signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { view?: UnlockView | null } | null) => { if (!ac.signal.aborted) { setView(j?.view ?? null); setNow(Date.now()); } })
        .catch(() => { if (!ac.signal.aborted) setView(null); });
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => { ac.abort(); window.clearInterval(t); };
  }, []);

  const nowS = now / 1000;
  const rows = (view?.upcoming ?? [])
    .filter((u) => u.ts >= nowS - 24 * 3600 && u.ts <= nowS + 14 * 86400 && (u.supplyShock || (u.pctCirc ?? 0) >= 1))
    .sort((a, b) => Number(b.supplyShock) - Number(a.supplyShock) || a.ts - b.ts)
    .slice(0, 6);

  return (
    <section className="m-2 rounded border border-violet-500/30 bg-slate-900/40 p-3 font-mono text-[11px] text-slate-300" aria-label="Upcoming unlocks" data-testid="upcoming-unlocks">
      <h2 className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        Upcoming unlocks
        <Link href="/unlocks" className="ml-auto normal-case tracking-normal text-slate-600 hover:text-cyan-300">all →</Link>
      </h2>
      {view === undefined ? (
        <p className="text-slate-500">loading…</p>
      ) : view === null ? (
        <p className="text-slate-500">
          The unlock calendar has not loaded yet. <Link href="/setup" className="text-cyan-300 hover:underline">Check setup →</Link>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">No big unlocks in the next 14 days.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((u) => (
            <li key={u.id}>
              <Link href={`/coin/${u.symbol}`} className="block hover:bg-slate-800/60">
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong>{u.symbol}</strong>
                  <span className="text-slate-300">{fmtPct(u.pctCirc)}</span>
                  <span className="text-slate-500">{etDate(u.ts)} · {whenText(u.ts, now)}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <UnlockBadges u={u} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
