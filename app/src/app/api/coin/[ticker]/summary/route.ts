import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readUnlockView } from "@/lib/unlocksServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MoveCacheEntry = { at: number; data: { changePct: number | null; rangePct: number | null } | null };
const moveCache = new Map<string, MoveCacheEntry>();

type UnlockRow = {
  symbol: string;
  name?: string;
  ts_ms: number;
  tokens?: number | null;
  pct_circ?: number | null;
  max_pct?: number | null;
  supply_shock?: boolean;
};


async function fetchMove24h(ticker: string): Promise<{ changePct: number | null; rangePct: number | null } | null> {
  const cached = moveCache.get(ticker);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  let data: { changePct: number | null; rangePct: number | null } | null = null;
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${ticker}USDT`, {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.ok) {
      const j = await res.json();
      const pct = Number(j.priceChangePercent);
      const high = Number(j.highPrice);
      const low = Number(j.lowPrice);
      const rangePct = low > 0 ? Math.round(((high - low) / low) * 1000) / 10 : null;
      data = { changePct: Number.isFinite(pct) ? pct : null, rangePct };
    }
  } catch {
    data = null;
  }
  moveCache.set(ticker, { at: Date.now(), data });
  return data;
}

async function loadCalendar(): Promise<UnlockRow[] | null> {
  // Public build: the unlock calendar view written by the collector (ingest/unlocks).
  const view = readUnlockView();
  if (!view || !Array.isArray(view.upcoming)) return null;
  return view.upcoming.map((u) => ({
    symbol: u.symbol,
    name: u.name,
    ts_ms: u.ts * 1000,
    tokens: u.tokens,
    pct_circ: u.pctCirc,
    supply_shock: u.supplyShock,
  }));
}
function etDate(tsMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(tsMs));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const ticker = ((await params).ticker || "").toUpperCase();
    if (!/^[A-Z0-9]{1,15}$/.test(ticker)) {
      return NextResponse.json({ error: "invalid ticker" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const instrument = await prisma.instrument.findUnique({ where: { ticker } });
    if (!instrument) {
      return NextResponse.json({ error: "unknown ticker" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const now = Date.now();
    const since = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const posts = await prisma.post.findMany({
      where: {
        instruments: { some: { ticker } },
        publishedAt: { gte: since, lte: new Date(now + 5 * 60 * 1000) },
      },
      select: {
        id: true,
        title: true,
        url: true,
        sourceDomain: true,
        publishedAt: true,
        sentiment: true,
        category: true,
        importance: true,
      },
      orderBy: { publishedAt: "desc" },
      take: 5000,
    });

    const counts = {
      total: posts.length,
      important: posts.filter((p) => p.importance >= 50).length,
      bullish: posts.filter((p) => p.sentiment === "bullish").length,
      bearish: posts.filter((p) => p.sentiment === "bearish").length,
      neutral: posts.filter((p) => p.sentiment === "neutral").length,
    };

    const byCategory: Record<string, number> = {};
    for (const p of posts) {
      if (p.category === "other") continue;
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    }

    const top = [...posts]
      .sort((a, b) => (b.importance - a.importance) || (b.publishedAt.getTime() - a.publishedAt.getTime()))
      .slice(0, 3)
      .map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        sourceDomain: p.sourceDomain,
        publishedAt: p.publishedAt.toISOString(),
        category: p.category,
        importance: p.importance,
        sentiment: p.sentiment,
      }));

    const move24h = await fetchMove24h(ticker);

    // next unlock
    let nextUnlock: {
      date_et: string;
      days: number;
      pct_circ: number | null;
      tokens: number | null;
      supply_shock: boolean;
    } | null = null;
    const rows = await loadCalendar();
    if (rows) {
      const candidates = rows.filter((r) => r.symbol === ticker && r.ts_ms >= now - 24 * 60 * 60 * 1000);
      candidates.sort((a, b) => a.ts_ms - b.ts_ms);
      const row = candidates[0];
      if (row) {
        const pct = row.pct_circ != null ? Math.round(row.pct_circ * 10) / 10 : null;
        nextUnlock = {
          date_et: etDate(row.ts_ms),
          days: Math.round((row.ts_ms - now) / 86400000),
          pct_circ: pct,
          tokens: typeof row.tokens === "number" ? row.tokens : null,
          supply_shock: Boolean(row.supply_shock) || (pct != null && pct >= 5),
        };
      }
    }

    // plain-words text
    const what =
      counts.total === 0
        ? `No news about ${ticker} in the last 7 days.`
        : `In the last 7 days there were ${counts.total} stories about ${ticker}. ${counts.important} were important.`;

    let mood: string | null = null;
    if (counts.total > 0) {
      if (counts.bullish > counts.bearish * 1.5) {
        mood = `Most news sounded positive (${counts.bullish} good vs ${counts.bearish} worrying).`;
      } else if (counts.bearish > counts.bullish * 1.5) {
        mood = `Most news sounded worrying (${counts.bearish} worrying vs ${counts.bullish} positive).`;
      } else {
        mood = `The news was mixed (${counts.bullish} positive, ${counts.bearish} worrying).`;
      }
    }

    let move: string | null = null;
    if (move24h && move24h.changePct != null) {
      const sign = move24h.changePct > 0 ? "+" : "";
      move = `Price changed ${sign}${move24h.changePct.toFixed(1)}% in the last 24 hours`;
      if (move24h.rangePct != null && move24h.rangePct >= 8) {
        move += ` — a big swing (range ${move24h.rangePct.toFixed(1)}%).`;
      } else {
        move += ".";
      }
    }

    const events: string[] = [];
    const eventCats = ["hack", "unlock", "listing", "delisting", "etf", "regulatory"];
    for (const c of eventCats) {
      if (byCategory[c]) { const n = byCategory[c]; const label = ({ hack: "hack", unlock: "unlock", listing: "listing", delisting: "delisting", etf: "ETF", regulatory: "regulation" } as Record<string, string>)[c] || c; events.push(`${n} ${label} ${n === 1 ? "story" : "stories"}`); }
    }

    let unlock: string | null = null;
    if (nextUnlock) {
      const date = nextUnlock.date_et;
      if (nextUnlock.pct_circ == null) {
        unlock = `Coins unlock on ${date} (size unknown).`;
      } else if (nextUnlock.days >= 0) {
        unlock = nextUnlock.pct_circ < 0.1 ? `A very small unlock (less than 0.1% more coins) in ${nextUnlock.days} days (${date}).` : `About ${nextUnlock.pct_circ}% more coins unlock in ${nextUnlock.days} days (${date}).`;
      } else {
        unlock = `Coins unlocked on ${date}.`;
      }
      if (nextUnlock.supply_shock) {
        unlock += " That is a big supply shock — more coins can be sold.";
      }
    }

    const watch: string[] = [];
    if (nextUnlock && nextUnlock.supply_shock) watch.push("Watch the unlock date and whether the price holds before it.");
    if (byCategory.hack) watch.push("Watch for the team's update on the hack.");
    if (move24h && move24h.rangePct != null && move24h.rangePct >= 8) watch.push("Big swings — moves can reverse fast.");
    if (counts.bearish > counts.bullish) watch.push("Watch if more worrying news follows.");
    if (watch.length === 0) watch.push("Watch the next important headline for this coin.");

    const evidence =
      counts.total >= 10 && move24h != null
        ? "Strong"
        : counts.total >= 3
        ? "Moderate"
        : "Limited";

    return NextResponse.json(
      {
        ticker,
        name: instrument.name,
        generated_at: new Date().toISOString(),
        counts,
        byCategory,
        top,
        move24h:
          move24h == null
            ? null
            : { changePct: move24h.changePct, range_24h_pct: move24h.rangePct },
        nextUnlock,
        text: { what, mood, move, events, unlock, watch: watch.slice(0, 3) },
        evidence,
        disclaimer: "Explains the news. Not advice. Nothing here says buy or sell.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "summary failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}