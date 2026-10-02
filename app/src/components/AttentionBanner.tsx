"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { DeviMark } from "@/components/devi";
import type { SetupStatus } from "@/lib/unlockTypes";

const KEY = "sahasra.attention.dismissed";
const HOURS_24 = 24 * 3600_000;

// "What deserves attention": shown at the top of the feed when an important safety feature is OFF or a data
// source failed recently. Dismiss hides it for 24 h, or until the list of problems changes.
export function AttentionBanner() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    const load = () =>
      fetch("/api/setup/status", { cache: "no-store", signal: ac.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SetupStatus>) : null))
        .then((s) => {
          if (ac.signal.aborted || !s) return;
          setStatus(s);
          const sig = s.attention.map((a) => a.id).join(",");
          let dismissed = false;
          try {
            const raw = window.localStorage.getItem(KEY);
            if (raw) {
              const j = JSON.parse(raw) as { sig: string; at: number };
              dismissed = j.sig === sig && Date.now() - j.at < HOURS_24;
            }
          } catch { /* storage blocked: just show it */ }
          setHidden(dismissed);
        })
        .catch(() => {});
    load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => { ac.abort(); window.clearInterval(t); };
  }, []);

  if (!status || !status.needsAttention || hidden) return null;
  const items = status.attention.slice(0, 3);

  const dismiss = () => {
    try { window.localStorage.setItem(KEY, JSON.stringify({ sig: status.attention.map((a) => a.id).join(","), at: Date.now() })); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <div className="attention-banner m-2 flex items-start gap-3 rounded p-3 font-mono text-[11px] text-slate-200" role="region" aria-label="What deserves attention" data-testid="attention-banner">
      <DeviMark devi="bhairava" size={34} play tooltip />
      <div className="min-w-0 flex-1">
        <h2 className="text-[10px] uppercase tracking-wider text-indigo-300">What deserves attention</h2>
        <ul className="mt-1 space-y-0.5">
          {items.map((a) => (
            <li key={a.id} className={a.state === "off" ? "text-amber-200" : "text-amber-300"}>{a.message}</li>
          ))}
        </ul>
        {status.attention.length > items.length ? <p className="mt-0.5 text-slate-500">…and {status.attention.length - items.length} more.</p> : null}
        <Link href="/setup" className="mt-1 inline-block text-cyan-300 hover:underline">How to fix this →</Link>
      </div>
      <button onClick={dismiss} aria-label="Hide for now" title="Hide for 24 hours" className="shrink-0 text-slate-500 hover:text-slate-200">
        <X size={14} />
      </button>
    </div>
  );
}
