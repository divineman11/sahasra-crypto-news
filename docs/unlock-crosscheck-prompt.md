# Unlock cross-check prompt (for any web-search-capable AI)

Sahasra builds its unlock calendar from two public sources (DefiLlama and Tokenomics). No single tracker is complete, so once a week
it can ask **your own AI** to compare our list with other trackers and point out gaps. This file is the contract:

- **Input:** Sahasra writes one JSON document to the command's standard input (our top 30 upcoming unlocks).
- **Output:** the command prints one JSON object on standard output with two lists, `missing` and `undercounted`.
- **Where it plugs in:** set `UNLOCK_CROSSCHECK_CMD` in `app/.env`. A ready wrapper is `app/scripts/crosscheck.example.js`.
  Any model works as long as it can browse the web. Keep your API keys in your own environment, never in the repository.

## Input document

```json
{
  "schema": "sahasra.unlock-crosscheck.v1",
  "generated_at": "2026-10-02T12:00:00.000Z",
  "ours": [
    { "symbol": "2Z", "name": "DoubleZero", "date": "2026-10-02", "tokens": 1655000000, "pct_of_circulating": 47.7, "sources": ["defillama", "tokenomics"] }
  ]
}
```

## Reply schema (the only thing the command may print)

```json
{
  "missing": [
    { "symbol": "TICKER", "date": "YYYY-MM-DD", "pct_of_circulating": 4.2, "tokens": 12000000, "source": "site name", "note": "one short sentence" }
  ],
  "undercounted": [
    { "symbol": "TICKER", "date": "YYYY-MM-DD", "our_pct": 1.1, "their_pct": 3.4, "source": "site name", "note": "one short sentence" }
  ]
}
```

Rules: `symbol` is letters and digits only; `date` is `YYYY-MM-DD` (UTC); numbers are plain numbers or `null`; empty lists are fine and common.
Anything that does not fit is dropped by Sahasra, and it only ever *displays* the rows as "CROSS-CHECK: possibly missing / under-counted". It never changes our numbers.

## The prompt

<!-- PROMPT START -->
You are checking a crypto token-unlock calendar for gaps. You have web search. Be factual and careful.

Below is OUR list of upcoming token unlocks as JSON (field `ours`). Compare it with these public trackers, using the live pages:
Tokenomist (tokenomist.ai), CoinMarketCal (coinmarketcal.com), CryptoRank (cryptorank.io/token-unlock) and DefiLlama (defillama.com/unlocks).

Find two kinds of problems, looking only at unlocks dated within the next 60 days:
1. "missing": a LARGE unlock (at least about 2% of circulating supply, or clearly big in dollars) that appears on at least one tracker but is not in OUR list.
2. "undercounted": an unlock that IS in our list, but a tracker shows a clearly bigger size (more than 1.5 times our percentage).

Rules:
- Only report what you actually saw on a tracker page. If you are unsure, leave it out. Empty lists are a good answer.
- Do not give investment advice, opinions or predictions. No price targets.
- `source` is the site name where you saw it. `note` is one short plain sentence (no links, no markdown).
- Reply with ONE JSON object and nothing else (no code fence, no commentary), exactly in this shape:
  {"missing":[{"symbol":"TICKER","date":"YYYY-MM-DD","pct_of_circulating":0,"tokens":0,"source":"","note":""}],"undercounted":[{"symbol":"TICKER","date":"YYYY-MM-DD","our_pct":0,"their_pct":0,"source":"","note":""}]}

OUR LIST:
{{INPUT}}
<!-- PROMPT END -->
