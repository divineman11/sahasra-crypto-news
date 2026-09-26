# Crypto News Terminal

A dense, Bloomberg-style crypto news terminal. Next.js 15 + React 19 + Tailwind v3 + Prisma (PostgreSQL) + Redis + WebSocket live feed.

## Prerequisites

- Node 20+
- PostgreSQL (any recent version), running on `localhost:5432` with a database and user created for the app
- Redis inside WSL Ubuntu, installed with:

  ```
  wsl -d Ubuntu -u root -- sh -c "apt-get update && apt-get install -y redis-server"
  ```

## Windows 11 setup

1. **Create your `.env`** by copying `.env.example` to `.env` and filling in your PostgreSQL credentials:

   ```
  copy .env.example .env
   ```

2. **Install dependencies**:

   ```
   npm install
   ```

3. **Create the database schema**:

   ```
   npm run db:push
   ```

4. **Run everything** — `npm run all` starts Redis (via `npm run redis`) together with Next.js, the WebSocket server and the ingest worker:

   ```
   npm run all
   ```

5. **Open the terminal**: http://localhost:4180

## Ports

- Next.js: 4180
- WebSocket server: 4181

## News sources

The ingest worker polls real news and market sources:

| Source | What | Poll every |
| --- | --- | --- |
| Bybit | Announcements | 5 s |
| Bitget | Announcements | 5 s |
| KuCoin | Announcements | 5 s |
| Bithumb | Notices (Korean titles) | 2 s |
| Binance | Announcements (unofficial CMS endpoint, alternates ~7 s between listings and delistings, may break) | ~7 s |
| Binance spot | New-market detection | 10 s |
| Binance futures | New-market detection | 10 s |
| Hyperliquid | New-market detection | 10 s |
| Crypto RSS | 7 crypto RSS feeds | 90 s |
| SEC | Press releases (only when `SEC_USER_AGENT` is set) | — |

## How stories are scored

- **Category rules** — each story is classified into one of: listing, delisting, hack, etf, regulatory, maintenance, other.
- **Importance** — exchange listing 95, delisting 90, hack 85, ETF/regulatory 70, maintenance 40, news listing 60, other 20.
- **Story merging** — duplicate stories are merged when they share the same headline fingerprint within 6 h, or when they describe the same listing/delisting ticker at the same exchange.
- **Hot** = importance ≥ 70 and published ≤ 48 h ago.
- **Rising** = picked up by ≥ 2 sources within 60 min.
- **Exchange filter** — stories can be filtered by exchange.

## Price check

- 1-, 5- and 15-minute Binance-perp price moves are measured ~16 minutes after a story is first seen.
- `node ingest/report.js --days 7` prints the hit-rate per source/category; add `--discord` to also post it to Discord.

## Integrations

- The ingest worker writes `news_live.json` (default `app/news_live.json`, override with `NEWS_LIVE_JSON`): a JSON summary of recent per-coin news (48 h window, important items per coin plus counts) a machine-readable export.
- HTTP API:
  - `GET /api/news?ticker=SOL&since=48h&minImportance=50`
  - `GET /api/news/flags?tickers=BTC,ETH`

## Optional settings

See `.env.example`:

- `DISCORD_NEWS_WEBHOOK` — post news digests to Discord.
- `NEWS_PORTFOLIO` — comma-separated watch-list tickers (Discord alerts + fastest Google News tier).
- `SEC_USER_AGENT` — enables SEC press-release polling.

## Labels

- Each story supports ✓ **catalyst** and ✕ **dismiss** labels.
- Dismissed stories are dimmed and excluded from news_live.json.

## Notes

- Requires PostgreSQL running locally with a `cryptonews` database (see `DATABASE_URL` in `.env`).
- Redis runs in WSL, and WSL shuts down when idle, so Redis must run as a foreground process. `npm run all` starts Redis (via `npm run redis`) together with Next.js, the WebSocket server and the ingest worker. If you want to run `npm run db:seed` on its own, run `npm run redis` in a separate terminal first.
- If one process crashes, `npm run all` restarts it up to 3 times and keeps the others running.
- The app binds to 127.0.0.1 only: http://localhost:4180 (web) and ws://localhost:4181 (WebSocket feed).
- The UI starts with mock data and switches to LIVE once the API and WebSocket feed connect.