"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { DeviMark } from "@/components/devi";
import type { SetupFeature, SetupStatus } from "@/lib/unlockTypes";

const LABEL: Record<SetupFeature["state"], string> = { on: "ON", off: "OFF", warn: "CHECK" };

// What to type into app/.env for each switch (placeholders only; no real keys).
const ENV_HINT: Record<string, string> = {
  crosscheck: 'UNLOCK_CROSSCHECK_CMD="node scripts/crosscheck.example.js"',
  discord: 'DISCORD_NEWS_WEBHOOK="https://discord.com/api/webhooks/..."',
  rewrite: 'EXPLAIN_REWRITE_CMD="node my-rewrite-script.js"',
  redis: "# remove the line NEWS_REDIS=off, then start with: npm run all",
  unlockCalendar: "# remove the line UNLOCKS_ENABLED=0",
  coingeckoSupply: "# remove the line COINGECKO_SUPPLY=0",
  collector: "npm run ingest:lite",
};

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null | undefined>(undefined);

  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      fetch("/api/setup/status", { cache: "no-store", signal: ac.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SetupStatus>) : null))
        .then((s) => { if (!ac.signal.aborted) setStatus(s); })
        .catch(() => { if (!ac.signal.aborted) setStatus(null); });
    load();
    const t = window.setInterval(load, 15_000);
    return () => { ac.abort(); window.clearInterval(t); };
  }, []);

  const todo = (status?.features ?? []).filter((f) => f.state !== "on" && f.fix);

  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800">
        <main className="mx-auto max-w-3xl p-4 text-xs text-slate-300">
          <Link href="/" className="text-slate-500 hover:text-slate-300">back to feed</Link>
          <div className="mt-4 flex items-center gap-3">
            <DeviMark devi="bhairava" size={56} play replay />
            <div>
              <h2 className="text-[10px] uppercase tracking-wider text-slate-500">Setup and safety</h2>
              <h1 className="mt-0.5 font-sans text-lg font-semibold text-slate-100">Is everything switched on?</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-slate-400">
            Sahasra can only warn you about what it can see. This page shows which protections are on, and gives a simple fix for each one that is off.
            It checks again every 15 seconds.
          </p>

          {status === undefined ? (
            <p className="mt-6 text-slate-500">checking…</p>
          ) : status === null ? (
            <p className="mt-6 text-amber-300">Could not read the status. Is the web server running?</p>
          ) : (
            <>
              <table className="mt-5 w-full border-collapse text-left" data-testid="setup-table">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-1 pr-3 font-normal">Status</th>
                    <th className="py-1 pr-3 font-normal">What</th>
                    <th className="py-1 font-normal">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {status.features.map((f) => (
                    <tr key={f.id} className="border-b border-slate-800/60 align-top" data-feature={f.id}>
                      <td className="py-2 pr-3"><span className={`setup-state setup-${f.state}`}>{LABEL[f.state]}</span></td>
                      <td className="py-2 pr-3 font-semibold text-slate-100">
                        {f.label}
                        {f.important ? <span className="ml-1 text-[9px] font-normal uppercase text-indigo-300">important</span> : null}
                      </td>
                      <td className="py-2 text-slate-400">{f.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {status.sourcesFailed.length > 0 ? (
                <p className="mt-4 text-amber-300" data-testid="sources-failed">
                  Recently failed: {status.sourcesFailed.map((s) => s.name).join(", ")}. The collector keeps retrying by itself.
                </p>
              ) : null}

              <h2 className="mt-8 font-sans text-sm font-semibold text-slate-100">Step by step</h2>
              {todo.length === 0 ? (
                <p className="mt-2 text-emerald-400">Nothing to fix. Everything that matters is on.</p>
              ) : (
                <ol className="mt-3 space-y-5" data-testid="setup-steps">
                  {todo.map((f, i) => (
                    <li key={f.id} className="rounded border border-slate-800 p-3">
                      <p className="font-semibold text-slate-100">
                        {i + 1}. {f.label} <span className={`setup-state setup-${f.state} ml-1`}>{LABEL[f.state]}</span>
                      </p>
                      <p className="mt-1 text-slate-300">{f.fix}</p>
                      {ENV_HINT[f.id] ? (
                        <pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-cyan-200">{ENV_HINT[f.id]}</pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}

              <h2 className="mt-8 font-sans text-sm font-semibold text-slate-100">How to change a setting</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
                <li>Open the file <code>app/.env</code> in any text editor (it is next to <code>package.json</code>).</li>
                <li>Add or change the line, then save the file.</li>
                <li>Stop the collector with <code>Ctrl+C</code> and start it again (<code>npm run all:lite</code>).</li>
                <li>Come back to this page. The status turns ON when it works.</li>
              </ol>
              <p className="mt-4 text-slate-500">
                Never share your <code>.env</code> file or paste its contents anywhere. Sahasra explains news; it does not give financial advice.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
