import {
  Building2,
  Landmark,
  MessageCircle,
  Newspaper,
  PenLine,
  PlayCircle,
  Radar,
  type LucideIcon,
} from "lucide-react";
import type { Category, Kind } from "@/lib/types";

export const CATEGORY_STYLE: Record<Category, { label: string; cls: string }> = {
  listing: { label: "LISTING", cls: "text-emerald-400 border-emerald-500/50" },
  delisting: { label: "DELISTING", cls: "text-rose-400 border-rose-500/50" },
  hack: { label: "HACK", cls: "text-red-400 border-red-500/60 bg-red-500/10" },
  etf: { label: "ETF", cls: "text-sky-400 border-sky-500/50" },
  regulatory: { label: "REGULATORY", cls: "text-amber-400 border-amber-500/50" },
  maintenance: { label: "MAINT", cls: "text-slate-400 border-slate-600" },
  other: { label: "", cls: "" },
};

export const SENTIMENT_CHIP: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "text-emerald-400 border-emerald-500/40",
  bearish: "text-rose-400 border-rose-500/40",
  neutral: "text-cyan-300 border-cyan-500/30",
};

export function kindIcon(kind: Kind): { Icon: LucideIcon; cls: string; label: string } {
  switch (kind) {
    case "exchange":
      return { Icon: Building2, cls: "text-lime-400", label: "EXCHANGE" };
    case "symbol":
      return { Icon: Radar, cls: "text-cyan-400", label: "NEW MARKET" };
    case "regulator":
      return { Icon: Landmark, cls: "text-amber-400", label: "REGULATOR" };
    case "media":
      return { Icon: PlayCircle, cls: "text-fuchsia-400", label: "MEDIA" };
    case "blog":
    case "official":
      return { Icon: PenLine, cls: "text-amber-400", label: kind === "official" ? "OFFICIAL" : "BLOG" };
    case "social":
      return { Icon: MessageCircle, cls: "text-violet-400", label: "SOCIAL" };
    case "news":
    default:
      return { Icon: Newspaper, cls: "text-sky-400", label: "NEWS" };
  }
}

export function fmtTime(iso: string, withSeconds?: boolean): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  if (!withSeconds) return `${h}:${m}`;
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

// Published time for list rows: today-ish (<24h) → "HH:MM"; older → "DD/MM HH:MM" (local time).
export function fmtPubTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  if (now - d.getTime() < 24 * 3600 * 1000) return `${h}:${mi}`;
  const da = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${da}/${mo} ${h}:${mi}`;
}

export function fmtRet(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}