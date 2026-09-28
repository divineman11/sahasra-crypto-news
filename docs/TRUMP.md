# Trump section

Sahasra has a separate Trump section (left sidebar → Trump). It shows Trump's own Truth Social posts and Trump market news. Trump items are stored with kind "politics"; they never appear in the crypto feed or its filters, never get coin tags, never show on coin pages, in trending coins, in /api/news or the news file, and never trigger Discord alerts. Code: app/ingest/adapters/trump.js. Turn it off with TRUMP_ENABLED=0.

## Sources and timing

| Source | What | How often |
|---|---|---|
| Truth Social posts | trumpstruth.org/feed (a public mirror of @realDonaldTrump); falls back to a Google News "Truth Social" search if the mirror fails | every 2 min |
| Google News (3 searches: market keywords, Reuters/AP, broad) | real publish date verified, see below | every 15 min (TRUMP_GNEWS_INTERVAL_MIN) |
| CNBC top news | only items that mention Trump and a market keyword | every 5 min |
| White House presidential actions and releases | official, no keyword filter, last 24 h | every 5 min |

Trump items do show up in the search box, like every other story.

## Why Google News dates are checked

Google News RSS often gives an old story a new date when it re-indexes it (a story dated today can be days old). For each Google item Sahasra:

1. Decodes the Google link to the real article URL.
2. Reads the publish date from the article page (article:published_time, JSON-LD datePublished, itemprop, `<time>`) and drops it if older than 2 hours. Full timestamps without a time zone, and dates in the future, are not trusted. A date-only value from today counts as unverified; a date-only value from an earlier day marks the story as old.
3. If the page cannot be read (paywall, block, timeout), it searches Google News for the exact headline; if any copy is older than 2 hours the story is dropped. Otherwise it is kept and marked "[date unverified]".

## Limits (to stay polite to Google)

- At most 6 article checks and 4 headline searches per Google search per pass.
- Google searches run every 15 minutes (TRUMP_GNEWS_INTERVAL_MIN).
- Daily cap on all Google requests from the Trump section: TRUMP_GNEWS_DAILY_BUDGET (default 2000). When reached, Google sources pause until 00:00 UTC; Truth Social posts from the mirror, CNBC and White House keep working, but the Google fallback for Truth Social also pauses.
- Failed lookups are remembered for 6 hours; items already sent are not re-checked for 3 hours.

## Settings

| Setting | Meaning | Default |
|---|---|---|
| TRUMP_ENABLED | 1/0 | 1 |
| TRUMP_GNEWS_INTERVAL_MIN | minutes between Google searches (minimum 5) | 15 |
| TRUMP_GNEWS_DAILY_BUDGET | daily cap on Google requests (minimum 50) | 2000 |

## Known failures and how to fix them

### Trump section is empty

**What you see:** No items under Trump.

**Why:** The collector is not running, TRUMP_ENABLED=0, or all sources failed.

**Fix:** Check the ingest log for lines starting with "[trump]"; make sure TRUMP_ENABLED is not 0; restart the collector. The page loads the Trump section separately (/api/posts?kind=politics), so busy crypto news cannot push it out.

### No Truth Social posts

**What you see:** No direct Truth Social posts; the section then shows Google News stories about his Truth Social posts (source trump:truth-fallback), checked at most every TRUMP_GNEWS_INTERVAL_MIN minutes.

**Why:** trumpstruth.org is down or blocking (it is an unofficial third-party mirror; truthsocial.com itself blocks automated readers with Cloudflare).

**Fix:** Nothing to do if the fallback works; if the mirror is gone for good, replace TRUTH_FEED in trump.js with another mirror of @realDonaldTrump.

### Every Google story says "[date unverified]"

**What you see:** All Google-sourced stories are marked "[date unverified]".

**Why:** The link decoder uses Google's undocumented batchexecute endpoint ("garturlreq"/"Fbv4je"); when Google changes it, decoding fails.

**Fix:** Check decodeGoogleLink() in trump.js against a current Google News article page (data-n-a-sg / data-n-a-ts attributes) and update the request format; until then stories still arrive, just unverified.

### "[trump] daily Google request budget reached" in the log

**What you see:** Log line "[trump] daily Google request budget reached".

**Why:** The daily cap was hit.

**Fix:** Raise TRUMP_GNEWS_DAILY_BUDGET or raise TRUMP_GNEWS_INTERVAL_MIN; Google sources resume at 00:00 UTC.

### Google returns errors (HTTP 429 / 503) or a consent/captcha page

**What you see:** Google requests fail with HTTP 429 or 503, or return a consent/captcha page.

**Why:** Too many requests from your IP (the crypto Google News source shares it).

**Fix:** Raise TRUMP_GNEWS_INTERVAL_MIN, lower TRUMP_GNEWS_DAILY_BUDGET, and/or lower GNEWS_DAILY_BUDGET for the crypto source.

### "[trump] whitehouse-… failed: HTTP 403"

**What you see:** Log line "[trump] whitehouse-… failed: HTTP 403".

**Why:** whitehouse.gov sometimes blocks a feed path for an IP (seen with /news/feed/).

**Fix:** Switch that entry to another White House feed that still answers (for example /releases/feed/ or /briefings-statements/feed/) in the sources list in trump.js.

### "[trump] cnbc failed"

**What you see:** Log line "[trump] cnbc failed".

**Why:** CNBC changed or retired the feed URL.

**Fix:** Replace the CNBC URL in trump.js with a current CNBC RSS feed.

### An old story shows up anyway

**What you see:** An outdated story appears in the Trump section.

**Why:** The article page had no usable date and no older copy was found, so it was kept as "[date unverified]".

**Fix:** Treat "[date unverified]" stories with care; if one site does this often, add it to BAD_PUBLISHERS in trump.js.

### A relevant story is missing

**What you see:** A story you expected is not in the section.

**Why:** The noise filter drops stories without a market keyword and drops opinion/analysis pieces.

**Fix:** Add the word to GOOD_KEYWORDS (or remove it from BAD_KEYWORDS) in trump.js.

## Checking it by hand

Run from app/:

```
node -e "require('./ingest/adapters/trump').make().forEach(a => a.run().then(items => console.log(a.name, items.length, items.slice(0,3).map(i => i.title))))"
```

It fetches once and prints what each Trump source would add, without touching the database.