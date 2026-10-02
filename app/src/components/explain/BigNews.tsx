"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ExplainEvent } from "@/lib/explainTypes";
import { explainTag, fetchExplainList } from "@/lib/explainApi";
import { etClock, etDay } from "@/lib/timeET";
import { DeviMark } from "../devi";

const DOTS = { Strong: 3, Moderate: 2, Limited: 1 } as const;

function sixWords(s: string): string {
  const w = s.replace(/\s+/g, " ").trim().split(" ");
  return w.length <= 6 ? w.join(" ") : w.slice(0, 6).join(" ") + "…";
}

// Right sidebar: today's explain events (max 5): Tara 18 px, coin, plain tag, 6-word what, time ET, evidence dots.
export function BigNews() {
  const [events, setEvents] = useState<ExplainEvent[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const load = () => fetchExplainList(30, undefined, ac.signal).then((e) => { if (!ac.signal.aborted) setEvents(e); }).catch(() => {});
    load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => { ac.abort(); window.clearInterval(t); };
  }, []);
  const today = etDay(Date.now());
  const rows = (events ?? []).filter((e) => etDay(e.created_at) === today).slice(0, 5);
  return (
    <section className="m-2 rounded border border-cyan-500/30 bg-slate-900/40 p-3 font-mono text-[11px] text-slate-300" aria-label="Big news today" data-testid="big-news">
      <h2 className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        Big news · today
        <Link href="/about/devis" className="ml-auto normal-case tracking-normal text-slate-600 hover:text-cyan-300" title="About the ten lenses">lenses →</Link>
      </h2>
      {rows.length === 0 ? (
        <p className="text-slate-500">{events === null ? "loading…" : "Nothing big yet today."}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => {
            const tag = explainTag(e.category, e.subtype);
            const on = DOTS[e.evidence.level] ?? 1;
            return (
              <li key={e.id} className="big-news-row">
                <Link href={`/post/${e.post_ids[0]}`} className="flex items-start gap-2 hover:bg-slate-800/60">
                  <DeviMark devi="tara" size={18} tooltip={false} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <strong>{e.coin ? e.coin.ticker : (e.topic ?? "market").replace(/_/g, " ")}</strong>
                      <span className={`ex-chip-tag ${tag.cls}`}>{tag.label}</span>
                      <span className="text-slate-500">{etClock(e.created_at)}</span>
                      <span className="ex-dots" aria-label={`Evidence ${e.evidence.level}`}>
                        {[0, 1, 2].map((i) => (
                          <span key={i} className={i < on ? "ex-dot ex-dot-on" : "ex-dot"} />
                        ))}
                      </span>
                    </span>
                    <span className="block text-slate-400">{sixWords(e.text.what)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
