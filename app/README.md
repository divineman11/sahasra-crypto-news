# Sahasra — app folder

Setup, commands and settings for **Windows, macOS and Linux** are in the main [README](../README.md).

This folder contains the whole application:

- `ingest.js` + `ingest/` — the news collector (sources, tagging, classification, storage)
- `src/` — the Next.js web terminal (port 4180) and its HTTP API
- `ws-server.js` — optional live-update WebSocket server (port 4181, needs Redis)
- `supervisor.js` / `start-news-hidden.vbs` — optional background runner (the `.vbs` is Windows-only)
- `scripts/redis.js`, `scripts/with-env.js` — cross-platform helpers used by the npm scripts
- `prisma/schema.prisma` — database schema

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
| Trump — Truth Social | Trump's own posts (via the trumpstruth.org mirror; Google News fallback). Shown only in the separate Trump section | 2 min |
| Trump — market news | Google News (market-keyword, Reuters/AP and broad queries, real publish date verified against the article), CNBC, White House actions & releases. Shown only in the Trump section | 5 min |