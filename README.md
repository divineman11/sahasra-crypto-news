# Sahasra — the final path to the Oneness

A self-hosted, real-time **crypto news terminal** in the spirit of CryptoPanic — free, runs on your own machine, works on **Windows, macOS and Linux**.

It collects crypto news from exchanges, publishers, Google News, Telegram wires, official project releases, YouTube, Reddit and Bluesky; tags every story with the coins it is about; groups duplicates into stories; scores importance and sentiment; and shows everything in a fast Bloomberg-style web terminal with per-coin pages and search.

![stack](https://img.shields.io/badge/Next.js-15-black) ![stack](https://img.shields.io/badge/PostgreSQL-Prisma-336791) ![stack](https://img.shields.io/badge/Node-20%2B-339933)

---

## What you get

- **Live feed** of crypto news with age, source, coin tags, category (listing, delisting, hack, ETF, regulatory…), importance and sentiment.
- **Coin pages** — `http://localhost:4180/coin/BTC` — last 48 h / 7 d of news for one coin, with tabs: News · Exchange · Official · Social · Media.
- **Search** across all stories.
- **Filters:** Hot, Rising, Important, Bullish, Bearish, Exchange, Saved, and a “hide low-importance” toggle.
- **Sources (no API keys needed):**
  - Exchange announcements: Binance, Bybit, Bitget, KuCoin, Bithumb, Upbit, OKX, Coinbase, Hyperliquid (incl. new-market / delisting detection)
  - ~48 crypto news sites and regulator feeds (RSS)
  - Per-coin **Google News** search (budgeted, polite)
  - Telegram news wires (public channel pages)
  - Official project sources: GitHub releases, governance forums, blogs
  - YouTube crypto channels (Media tab)
  - Reddit crypto subreddits (keyless RSS; optional official API keys) and curated Bluesky accounts (Social tab)
- **Optional Discord alerts** for important news about coins on your watch list.
- **Price reaction:** measures the 1/5/15-minute Binance-perp move after each story; `node ingest/report.js --days 7` prints a hit-rate report.

---

## Requirements

| | Windows 10/11 | macOS | Linux |
|---|---|---|---|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) | `brew install node` | your package manager / nvm |
| **PostgreSQL 14+** | [postgresql.org installer](https://www.postgresql.org/download/windows/) | `brew install postgresql@16 && brew services start postgresql@16` | `sudo apt install postgresql` |
| **Redis** *(optional — only for the instant live-update feed)* | WSL Ubuntu: `wsl -d Ubuntu -u root -- sh -c "apt-get update && apt-get install -y redis-server"` | `brew install redis` | `sudo apt install redis-server` |

Without Redis everything still works — the web page just shows new stories on refresh instead of pushing them live. Use the `:lite` commands below.

---

## Setup (all platforms)

1. **Get the code and install**
   ```bash
   git clone https://github.com/divineman11/sahasra-crypto-news.git
   cd sahasra-crypto-news/app
   npm install
   ```

2. **Create a database** (example with the default `postgres` superuser — use your own names/passwords):
   ```bash
   psql -U postgres -c "CREATE USER cryptonews WITH PASSWORD 'change-me';"
   psql -U postgres -c "CREATE DATABASE cryptonews OWNER cryptonews;"
   ```

3. **Create your settings file**
   - macOS / Linux: `cp .env.example .env`
   - Windows (Command Prompt): `copy .env.example .env`  ·  (PowerShell): `Copy-Item .env.example .env`

   Then edit `.env` and set at least:
   ```
   DATABASE_URL="postgresql://cryptonews:change-me@localhost:5432/cryptonews?schema=public"
   NEWS_PORTFOLIO="BTC,ETH,SOL"      # your watch list (optional but recommended)
   ```

4. **Create the tables**
   ```bash
   npm run db:push
   ```

5. **Run it** — pick one:

   | Command | What it starts | Redis needed? |
   |---|---|---|
   | `npm run all:lite` | web terminal (dev) + news collector | **No** — easiest way to start |
   | `npm run all` | Redis + web (dev) + live-update server + collector | Yes (started for you) |
   | `npm run build` then `npm run all:prod` | same as `all`, production-speed web server | Yes |

6. **Open** http://localhost:4180 — stories start arriving within a minute; the first pass collects the last few days of news.

Stop everything with `Ctrl+C`.

### Running pieces separately

```bash
npm run ingest:lite   # news collector without Redis (any OS)
npm run ingest        # news collector with Redis
npm run dev           # web terminal on :4180 (development)
npm run build && npm start   # web terminal, production mode
npm run ws            # live-update WebSocket server on :4181 (needs Redis)
npm run redis         # start Redis: WSL on Windows, native redis-server on macOS/Linux
```

### Run in the background (optional)

- **Windows:** `supervisor.js` keeps the collector running and restarts it if it crashes. Double-click `start-news-hidden.vbs` to start it with no console window (add it to your Startup folder to start at login). Stop it by creating an empty file `logs/STOP`.
- **macOS / Linux:** `node supervisor.js` works the same way (use `node supervisor.js --with-ui` to also run Redis, the web server and the live-update server). Or use a process manager such as [pm2](https://pm2.keymetrics.io/): `pm2 start npm --name sahasra -- run all:lite`.

---

## Settings (`app/.env`)

Everything is optional except `DATABASE_URL`. See `.env.example` for the full list with comments. The most useful ones:

| Setting | What it does |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (**required**) |
| `NEWS_PORTFOLIO` | Your watch-list coins, e.g. `BTC,ETH,SOL`. Used for Discord alerts and the fastest Google News tier |
| `DISCORD_NEWS_WEBHOOK` | Discord channel webhook URL — enables alerts for important news on your watch-list coins |
| `REDIS_URL` | Redis address (default `redis://localhost:6379`) |
| `NEWS_REDIS="off"` | Run the collector without Redis (what the `:lite` commands set) |
| `GNEWS_TIERS` | Google News tiers: `A` = watch list, `B` = top-100 coins by volume, `C` = all others. Start with `"A,B"` |
| `GNEWS_DAILY_BUDGET` | Max Google News requests per day (default 5000) |
| `SEC_USER_AGENT` | Enables the SEC press-release feed (SEC requires a contact e-mail in the User-Agent) |
| `REDDIT_CLIENT_ID` / `_SECRET` / `_USERNAME` / `_PASSWORD` | Optional official Reddit API keys; without them Reddit is read via its public RSS feed |
| `TG_WIRES_ENABLED`, `OFFICIAL_ENABLED`, `YOUTUBE_ENABLED`, `REDDIT_ENABLED`, `BLUESKY_ENABLED` | Set to `"0"` to turn a source group off |

Ports: web **4180**, live-update WebSocket **4181** (both bound to `127.0.0.1` only).

---

## HTTP API

- `GET /api/posts` — latest stories (paginated)
- `GET /api/coin/BTC?range=48h` — one coin's stories
- `GET /api/search?q=solana` — search
- `GET /api/news?ticker=SOL&since=48h&minImportance=50` — per-coin news with counts
- `GET /api/news/flags?tickers=BTC,ETH` — compact risk/catalyst flags

The collector also writes `app/news_live.json` every 15 s — a JSON summary of recent per-coin news for scripting (path configurable with `NEWS_LIVE_JSON`).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Can't reach database server` | PostgreSQL isn't running or `DATABASE_URL` is wrong. Check with `psql "<your DATABASE_URL>"`. |
| `redis-server not found` / WSL errors | Install Redis (see Requirements) — or just use `npm run all:lite`. |
| Page says **CONNECTING** | The live-update server needs Redis. Stories still load; refresh to see new ones, or run with Redis (`npm run all`). |
| Port 4180 already in use | Stop the other app, or change the port in `package.json` (`dev`/`start` scripts). |
| Few items at first | Normal — sources are polled on staggered schedules; give it 5–10 minutes. |
| Google News `429` in the log | Lower `GNEWS_DAILY_BUDGET` or set `GNEWS_TIERS="A,B"`; it backs off automatically. |

---

## Notes

- Personal, self-hosted, non-commercial project. Respect each source's terms of use; polling intervals are deliberately conservative.
- Stories are kept for 7 days.
- Nothing here is financial advice.
