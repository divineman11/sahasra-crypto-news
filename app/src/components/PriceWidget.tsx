"use client";

import { useEffect, useState } from "react";

interface PriceEntry {
  ticker: string;
  name: string;
  usd: number;
  change24h: number;
}

interface PricesResponse {
  prices: PriceEntry[];
  fetchedAt: string;
  stale: boolean;
}

function formatPrice(v: number): string {
  if (v >= 1) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

export function PriceWidget() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/prices", { cache: "no-store" });
        if (res.ok) {
          const body: PricesResponse = await res.json();
          if (alive) setData(body);
        }
      } catch {
        // keep previous data
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="flex flex-col gap-1 p-3">
      <h2 className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
        Prices
        {data?.stale && <span className="rounded bg-amber-500/20 px-1 text-amber-400">stale</span>}
      </h2>
      {loading && !data ? (
        <p className="py-2 text-xs text-slate-600">Loading prices…</p>
      ) : !data || data.prices.length === 0 ? (
        <p className="py-2 text-xs text-slate-600">No price data available.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {data.prices.map((p) => (
            <li key={p.ticker} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-slate-300">${p.ticker}</span>
              <span className="font-mono text-slate-400 tabular-nums">${formatPrice(p.usd)}</span>
              <span
                className={`font-mono text-[10px] tabular-nums ${
                  p.change24h >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {p.change24h >= 0 ? "+" : ""}
                {p.change24h.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}