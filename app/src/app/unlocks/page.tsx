"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Badge, UnlockBadges } from "@/components/UnlockBadges";
import type { UnlockView } from "@/lib/unlockTypes";
import { etDate, etWeekday, fmtPct, fmtTokens, whenText } from "@/lib/unlockFormat";

const SRC_NAME: Record<string, string> = { defillama: "DefiLlama", tokenomics: "Tokenomics", manual: "manual" };

export default function UnlocksPage() {
  const [view, setView] = useState<UnlockView | null | undefined>(undefined);
  const [shockOnly, setShockOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/unlocks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { view?: UnlockView | null } | null) => { setView(j?.view ?? null); setNow(Date.now()); })
      .catch(() => setView(null));
  }, []);

  const rows = (view?.upcoming ?? []).filter((u) => !shockOnly || u.supplyShock);
  const cc = view?.crosscheck;

  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800">
        <main className="mx-auto max-w-5xl p-4 text-xs text-slate-300">
          <Link href="/" className="text-slate-500 hover:text-slate-300">back to feed</Link>
          <h2 className="mt-4 text-[10px] uppercase tracking-wider text-slate-500">Calendar</h2>
          <h1 className="mt-1 font-sans text-lg font-semibold text-slate-100">Upcoming unlocks</h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            An unlock is a day when coins that were locked become free to trade. The percentage is how much that adds to the coins already on the
            market. Dates are US Eastern. This is information, not financial advice.
          </p>

          {view === undefined ? (
            <p className="mt-6 text-slate-500">loading…</p>
          ) : view === null ? (
            <p className="mt-6 text-slate-400">
              The unlock calendar has not been downloaded yet. Start the collector (<code>npm run ingest:lite</code>) and wait a minute, or open{" "}
              <Link href="/setup" className="text-cyan-300 hover:underline">the setup page</Link>.
            </p>
          ) : (
            <>
              <label className="mt-4 flex items-center gap-2 text-[11px] text-slate-400 select-none">
                <input type="checkbox" checked={shockOnly} onChange={(e) => setShockOnly(e.target.checked)} className="h-3 w-3 accent-emerald-500" />
                Only SUPPLY SHOCK (5% or more of circulating)
              </label>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left" data-testid="unlock-table">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                      <th className="py-1 pr-3 font-normal">Date (ET)</th>
                      <th className="py-1 pr-3 font-normal">Coin</th>
                      <th className="py-1 pr-3 text-right font-normal">% of circulating</th>
                      <th className="py-1 pr-3 text-right font-normal">Coins</th>
                      <th className="py-1 pr-3 font-normal">Flags</th>
                      <th className="py-1 font-normal">Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.id} className="border-b border-slate-800/60">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {etWeekday(u.ts)} {etDate(u.ts)} <span className="text-slate-500">· {whenText(u.ts, now)}</span>
                        </td>
                        <td className="py-1.5 pr-3">
                          <Link href={`/coin/${u.symbol}`} className="font-semibold text-cyan-300 hover:underline">${u.symbol}</Link>{" "}
                          <span className="text-slate-500">{u.name !== u.symbol ? u.name : ""}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtPct(u.pctCirc)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtTokens(u.tokens)}</td>
                        <td className="py-1.5 pr-3"><span className="flex flex-wrap gap-1"><UnlockBadges u={u} /></span></td>
                        <td className="py-1.5 text-slate-500">{u.sources.map((s) => SRC_NAME[s] ?? s).join(" + ")}</td>
                      </tr>
                    ))}
                    {rows.length === 0 ? (
                      <tr><td colSpan={6} className="py-4 text-slate-500">Nothing to show.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <h2 className="mt-8 flex items-center gap-2 font-sans text-sm font-semibold text-slate-100">
                <Badge kind="missing">DATA MISSING</Badge> Coins with a lot still locked but no unlock date found
              </h2>
              <p className="mt-1 text-slate-500">More than 20% of the coins are still locked, yet no tracker lists an unlock in the next 60 days. Treat these as unknown, not safe.</p>
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="missing-list">
                {view.missing.length === 0 ? <li className="text-slate-500">None right now.</li> : view.missing.map((m) => (
                  <li key={m.symbol}>
                    <Link href={`/coin/${m.symbol}`} className="rounded border border-violet-500/40 px-2 py-0.5 text-violet-300 hover:brightness-125">
                      ${m.symbol} <span className="text-slate-500">{m.lockedPct}% locked</span>
                    </Link>
                  </li>
                ))}
              </ul>

              <h2 className="mt-8 flex items-center gap-2 font-sans text-sm font-semibold text-slate-100">
                <Badge kind="anniv">TGE ANNIVERSARY</Badge> Young coins close to a 6 or 12 month mark
              </h2>
              <p className="mt-1 text-slate-500">Many projects unlock 6 or 12 months after launch. These have no listed unlock near that date.</p>
              <ul className="mt-2 space-y-1" data-testid="anniv-list">
                {view.anniversaries.length === 0 ? <li className="text-slate-500">None right now.</li> : view.anniversaries.map((a) => (
                  <li key={a.symbol + a.months}>
                    <Link href={`/coin/${a.symbol}`} className="text-cyan-300 hover:underline">${a.symbol}</Link>{" "}
                    <span className="text-slate-400">{a.months}-month mark in about {Math.round(a.days)} days · {a.lockedPct}% still locked</span>
                  </li>
                ))}
              </ul>

              <h2 className="mt-8 flex items-center gap-2 font-sans text-sm font-semibold text-slate-100">
                <Badge kind="cross">CROSS-CHECK</Badge> Possibly missing or under-counted
              </h2>
              {!cc || !cc.enabled ? (
                <p className="mt-1 text-slate-500">
                  The weekly AI cross-check is off. <Link href="/setup" className="text-cyan-300 hover:underline">How to turn it on →</Link>
                </p>
              ) : (
                <>
                  <p className="mt-1 text-slate-500">
                    {cc.lastOkAt ? `Last checked ${new Date(cc.lastOkAt).toLocaleString()}.` : "Has not run yet."}
                    {cc.lastError ? ` Last run failed: ${cc.lastError}` : ""} These come from your own AI reading other trackers. Verify before relying on them.
                  </p>
                  <ul className="mt-2 space-y-1" data-testid="crosscheck-list">
                    {cc.items.length === 0 ? <li className="text-slate-500">Nothing flagged.</li> : cc.items.map((i, k) => (
                      <li key={k}>
                        <Badge kind="cross">{i.kind === "missing" ? "CROSS-CHECK: possibly missing" : "CROSS-CHECK: possibly under-counted"}</Badge>{" "}
                        <Link href={`/coin/${i.symbol}`} className="text-cyan-300 hover:underline">${i.symbol}</Link>{" "}
                        <span className="text-slate-400">
                          {i.date}
                          {i.pct != null ? ` · ${fmtPct(i.pct)}` : ""}
                          {i.kind === "undercounted" && i.ourPct != null ? ` (we show ${fmtPct(i.ourPct)})` : ""}
                          {i.source ? ` · ${i.source}` : ""}
                          {i.note ? ` · ${i.note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h2 className="mt-8 font-sans text-sm font-semibold text-slate-100">Where the numbers come from</h2>
              <ul className="mt-1 space-y-0.5 text-slate-500">
                {Object.entries(view.sources).map(([k, s]) => (
                  <li key={k}>
                    {SRC_NAME[k] ?? k}: {s.lastOkAt ? `updated ${new Date(s.lastOkAt).toLocaleString()}` : "never updated"}
                    {s.lastError ? <span className="text-amber-400"> · last error: {s.lastError}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
