import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PriceEntry {
  ticker: string;
  name: string;
  usd: number;
  change24h: number;
}

interface PricesBody {
  prices: PriceEntry[];
  fetchedAt: string;
  stale: boolean;
}

const COINS: { ticker: string; name: string; id: string }[] = [
  { ticker: "BTC", name: "Bitcoin", id: "bitcoin" },
  { ticker: "ETH", name: "Ethereum", id: "ethereum" },
  { ticker: "SOL", name: "Solana", id: "solana" },
  { ticker: "BNB", name: "BNB", id: "binancecoin" },
  { ticker: "XRP", name: "XRP", id: "ripple" },
  { ticker: "DOGE", name: "Dogecoin", id: "dogecoin" },
  { ticker: "ADA", name: "Cardano", id: "cardano" },
  { ticker: "AVAX", name: "Avalanche", id: "avalanche-2" },
  { ticker: "LINK", name: "Chainlink", id: "chainlink" },
  { ticker: "TON", name: "Toncoin", id: "the-open-network" },
];

let lastGood: PricesBody | null = null;

function buildBody(data: Record<string, { usd?: number; usd_24h_change?: number }>, fetchedAt: string): PricesBody {
  const prices: PriceEntry[] = [];
  for (const coin of COINS) {
    const entry = data[coin.id];
    if (entry && typeof entry.usd === "number") {
      prices.push({
        ticker: coin.ticker,
        name: coin.name,
        usd: entry.usd,
        change24h: typeof entry.usd_24h_change === "number" ? entry.usd_24h_change : 0,
      });
    }
  }
  return { prices, fetchedAt, stale: false };
}

export async function GET() {
  // 1. Try Redis cache
  try {
    const cached = await redis.get("prices:coingecko");
    if (cached) {
      return NextResponse.json(JSON.parse(cached), { headers: { "Cache-Control": "no-store" } });
    }
  } catch (err) {
    console.error("[api/prices] redis get failed:", err);
  }

  // 2. Fetch from CoinGecko
  const ids = COINS.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const body = buildBody(data, new Date().toISOString());

    if (body.prices.length > 0) {
      lastGood = body;

      try {
        await redis.set("prices:coingecko", JSON.stringify(body), "EX", 60);
      } catch (err) {
        console.error("[api/prices] redis set failed:", err);
      }

      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }

    const fallback: PricesBody = lastGood ?? { prices: [], fetchedAt: new Date().toISOString(), stale: true };
    const staleBody: PricesBody = { prices: fallback.prices, fetchedAt: fallback.fetchedAt, stale: true };
    return NextResponse.json(staleBody, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    clearTimeout(timer);
    console.error("[api/prices] fetch failed:", err);
    const fallback: PricesBody = lastGood ?? { prices: [], fetchedAt: new Date().toISOString(), stale: true };
    const body: PricesBody = { prices: fallback.prices, fetchedAt: fallback.fetchedAt, stale: true };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  }
}