"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeviMark } from "@/components/devi";
import { useFeedStore } from "@/store/useFeedStore";
import { SahasraLotus } from "@/components/SahasraLotus";
import { SearchBox } from "@/components/SearchBox";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export function TopBar() {
  const source = useFeedStore((s) => s.source);
  const wsStatus = useFeedStore((s) => s.wsStatus);
  const [clock, setClock] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setClock(`${hh}:${mm}:${ss}`);
      setToday(`${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const dot =
    wsStatus === "open"
      ? "bg-emerald-500"
      : wsStatus === "connecting"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <header className="sahasra-header grid grid-cols-[1fr_auto_1fr] items-center border border-slate-800 rounded px-3 py-2">
      {/* left: quiet counterweight — date + what this is + search */}
      <div className="flex flex-col gap-1.5 justify-self-start font-mono text-[10px] tracking-[0.22em] text-slate-500">
        <span className="text-slate-400">{today ?? ""}</span>
        <span>CRYPTO · NEWS · TERMINAL</span>
        <SearchBox />
      </div>

      {/* centre: emblem, wordmark, tagline */}
      <div className="flex flex-col items-center justify-self-center select-none">
        <SahasraLotus size={64} />
        <h1
          className="sahasra-wordmark mt-1 font-mono text-[26px] leading-none font-bold tracking-[0.42em] pl-[0.42em]"
          aria-label="Sahasra"
        >
          SAHASRA
        </h1>
        <p className="sahasra-tagline mt-1.5 flex items-center gap-2.5 font-mono text-[11px] leading-none tracking-[0.26em]">
          <span className="sahasra-rule" aria-hidden="true" />
          <span>the final path to the Oneness</span>
          <span className="sahasra-rule" aria-hidden="true" />
        </p>
        <Link
          href="/about/devis"
          className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] leading-none tracking-[0.26em] text-slate-500 hover:text-cyan-300"
        >
          <DeviMark devi="tara" size={12} tooltip={false} />
          <span>TEN LENSES</span>
        </Link>
      </div>

      {/* right: live status (unchanged semantics from the original bar) */}
      <div className="flex items-center gap-3 justify-self-end">
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            source === "live"
              ? "text-emerald-400 border-emerald-500/40"
              : "text-amber-400 border-amber-500/40"
          }`}
        >
          {source === "live" ? "LIVE" : "LOADING"}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {wsStatus.toUpperCase()}
        </span>
        <span className="font-mono text-xs text-slate-400 tabular-nums">{clock ?? ""}</span>
      </div>
    </header>
  );
}
