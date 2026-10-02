# AGENTS.md — Sahasra

Guidance for AI coding assistants (Claude Code, Codex, Cursor, etc.) and humans working on this repo.

## 1. What Sahasra is

Sahasra is a free, self-hosted crypto news terminal: a Next.js web app (port 4180) plus a Node news collector and PostgreSQL storage (Redis optional). News items come with "Understand this" cards that explain big news in plain words, including possible scenarios — they are explanations, **not financial advice**. The "Ten lenses" are original decorative symbols inspired by the Dasa Mahavidya, plus a Bhairava "Guardian" symbol used for warnings — a contemporary interpretation, not devotional images.

## 2. Setup

Walk the user through these steps:

1. Install Node 20+ and PostgreSQL 14+.
2. `cd app && npm install`
3. Create a PostgreSQL database and user.
4. Copy `.env.example` to `.env` and set `DATABASE_URL` (optionally `NEWS_PORTFOLIO`).
5. Run `npm run db:push`.
6. Start:
   - `npm run all:lite` — no Redis needed
   - `npm run all` — with Redis
   - `npm run all:prod` — after `npm run build`

## 3. Safety check

After setup, run `npm run setup:status` (or open `http://localhost:4180/setup`) and walk the user through **every** item marked OFF. Explain in simple words what each item protects and how to turn it on. The in-app Guardian (Bhairava) banner shows the same warnings.

## 4. Unlock safety

The unlock calendar (env: `UNLOCKS_ENABLED`, `COINGECKO_SUPPLY`, `UNLOCKS_TRACK_ALL`; commands: `npm run unlocks:fetch`, `npm run unlocks:print`) shows upcoming unlocks at `/unlocks` with badges:

- **SUPPLY SHOCK** — unlock ≥5% of circulating supply
- **SRC DISAGREE** — sources disagree
- **DATA MISSING** — no data found
- **TGE-anniversary** — seasonal unlock risk

Calendars can miss or under-count unlocks. Strongly recommend enabling the weekly AI cross-check: set `UNLOCK_CROSSCHECK_CMD` to a command that runs the user's own web-search-capable AI. The prompt lives in `docs/unlock-crosscheck-prompt.md`; an example wrapper is `app/scripts/crosscheck.example.js`. Test with `npm run unlocks:crosscheck`. Never send private keys to third parties without the user's explicit consent.

## 5. Optional features

- **Discord alerts** (`DISCORD_NEWS_WEBHOOK`), including 7/2/1-day supply-shock reminders.
- **Explain-card plain-words rewrite** (`EXPLAIN_REWRITE_CMD`): uses the user's own model; numbers are checked against source data so it cannot invent figures.

## 6. Rules for assistants

- Never commit `.env` or any secrets.
- Keep the "not financial advice" wording.
- Never invent numbers in explain cards.
- Run `npm test` and `npm run build` before proposing changes.
- Times shown in the UI are US Eastern (ET).

## 7. Troubleshooting

See the Troubleshooting section in `README.md`.