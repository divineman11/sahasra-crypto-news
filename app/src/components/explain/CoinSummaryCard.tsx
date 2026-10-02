"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeviMark } from "../devi";

type TopItem = {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  publishedAt: string;
  category: string;
  importance: string;
  sentiment: string;
};

type Summary = {
  ticker: string;
  name: string;
  counts: {
    total: number;
    important: number;
    bullish: number;
    bearish: number;
    neutral: number;
  };
  top: TopItem[];
  move24h: { changePct: number | null; range_24h_pct: number | null } | null;
  nextUnlock: {
    date_et: string;
    days: number;
    pct_circ: number;
    tokens: number;
    supply_shock: boolean;
  } | null;
  text: {
    what: string;
    mood: string | null;
    move: string | null;
    events: string[];
    unlock: string | null;
    watch: string[];
  };
  evidence: "Strong" | "Moderate" | "Limited";
  disclaimer: string;
  generated_at: string;
};

function SectionHeading({
  devi,
  label,
}: {
  devi: "kali" | "bhairavi" | "bhuvaneshwari" | "bhairava" | "tripurasundari" | "dhumavati";
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <DeviMark devi={devi} size={16} />
      <span className="ex-heading uppercase">{label}</span>
    </div>
  );
}

export function CoinSummaryCard({ ticker }: { ticker: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);

    fetch(`/api/coin/${encodeURIComponent(ticker)}/summary`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((json: Summary) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (loading) {
    return (
      <section className="explain-card mt-3 p-3">
        <p className="text-slate-500 text-[12px]">understanding ${ticker}…</p>
      </section>
    );
  }

  if (!data) return null;

  const evidenceDots = data.evidence === "Strong" ? 3 : data.evidence === "Moderate" ? 2 : 1;

  return (
    <section className="explain-card mt-3 p-3">
      <div className="flex items-center gap-2">
        <DeviMark devi="tara" size={28} />
        <span className="ex-title">UNDERSTAND THIS COIN</span>
        <span className="text-[10px] text-slate-500 truncate">
          ${data.ticker} · {data.name}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  i < evidenceDots ? "bg-emerald-400" : "bg-slate-700"
                }`}
              />
            ))}
          </span>
          <span className="text-[10px] text-slate-500">Evidence: {data.evidence}</span>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="text-[10px] text-slate-400 border border-slate-700 rounded px-2 py-0.5 hover:text-slate-200"
          >
            {open ? "Close ✕" : "Open"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <SectionHeading devi="kali" label="What changed" />
            <p className="text-slate-300 text-[12px] leading-relaxed">{data.text.what}</p>
            {data.text.mood && (
              <p className="text-slate-300 text-[12px] leading-relaxed mt-1">{data.text.mood}</p>
            )}
          </div>

          {data.text.move && (
            <div>
              <SectionHeading devi="bhairavi" label="Price" />
              <p className="text-slate-300 text-[12px] leading-relaxed">{data.text.move}</p>
            </div>
          )}

          {data.text.events.length > 0 && (
            <div>
              <SectionHeading devi="bhuvaneshwari" label="Events" />
              <ul className="list-disc list-inside text-slate-300 text-[12px] leading-relaxed">
                {data.text.events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {data.text.unlock && (
            <div>
              <SectionHeading devi="bhairava" label="Unlock watch" />
              <p className="text-slate-300 text-[12px] leading-relaxed">
                {data.nextUnlock?.supply_shock && (
                  <span className="ex-tag text-rose-400">SUPPLY SHOCK</span>
                )}{" "}
                {data.text.unlock}
              </p>
            </div>
          )}

          {data.top.length > 0 && (
            <div>
              <SectionHeading devi="tripurasundari" label="Top stories" />
              <ul className="space-y-1">
                {data.top.slice(0, 3).map((item) => (
                  <li key={item.id} className="text-[12px] leading-relaxed">
                    <Link href={`/post/${item.id}`} className="text-slate-300 hover:underline truncate">
                      {item.title}
                    </Link>
                    <span className="text-slate-500"> · {item.sourceDomain}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.text.watch.length > 0 && (
            <div>
              <SectionHeading devi="dhumavati" label="What to watch" />
              <ul className="list-disc list-inside text-slate-300 text-[12px] leading-relaxed">
                {data.text.watch.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[10px] text-slate-500 mt-2">{data.disclaimer}</p>
            <Link href="/about/devis" className="ex-about">
              About the ten lenses →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}