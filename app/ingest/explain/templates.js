'use strict';
// templates: pure functions (facts) -> text. Kid-level wording; NO number unless it is in `facts`.
// Every scenario has timeframe / condition / evidence. No price targets, no advice words.
const { etShort } = require('./timeET');

// ---- number formatting (exact: a compact form is used only when it round-trips to the same number) ----
function fmtCount(n) {
  if (n == null) return null;
  for (const [u, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= u) {
      const c = Math.round((n / u) * 100) / 100;
      if (Math.round(c * u) === n) return `${c} ${w}`;
    }
  }
  return Math.round(n).toLocaleString('en-US');
}
const fmtUsd = (n) => (n == null ? null : '$' + fmtCount(n));

const sc = (dir, title, timeframe, condition, evidence) => ({ dir, title, timeframe, condition, evidence, base_rate: null });
const w = (label, detail) => ({ label, detail });
const a = (who, how) => ({ who, how });

function dateOf(f) {
  if (f.unlock_date_et) return f.unlock_date_et;
  if (f.published_at) return etShort(f.published_at);
  return null;
}
const on = (d) => (d ? ` on ${d}` : '');
const NO_CASES = 'Not enough comparable cases';
const RANGE = 'The day\'s price range stays wide.';

// ---------------------------------------------------------------- unlock
function unlock(f) {
  const T = f.ticker || 'this coin';
  const pct = f.unlock_pct_circ;
  const d = f.unlock_date_et;
  let what;
  const tp = f.unlock_pct;
  if (f.unlock_past) {
    // The unlock calendar says it happened within the last 24 hours: past tense.
    if (pct != null) what = d ? `On ${d} about ${pct}% more ${T} coins became free to trade.` : `About ${pct}% more ${T} coins just became free to trade.`;
    else what = d ? `On ${d} a large batch of ${T} coins became free to trade.` : `A large batch of ${T} coins just became free to trade.`;
  } else if (pct == null && tp != null && d) what = `On ${d} coins equal to about ${tp}% of all ${T} that will ever exist become free to trade.`;
  else if (pct == null && tp != null) what = `Coins equal to about ${tp}% of all ${T} that will ever exist are due to become free to trade soon.`;
  else if (pct != null && d) what = `On ${d} about ${pct}% more ${T} coins become free to trade.`
  else if (pct != null) what = `About ${pct}% more ${T} coins are due to become free to trade soon.`;
  else what = `A large batch of ${T} coins is due to become free to trade.`;
  if (f.unlock_tokens != null) what += ` That is ${fmtCount(f.unlock_tokens)} coins.`;
  const uncertain = ['Which wallets receive the coins is not confirmed.'];
  if (f.unlock_source === 'calendar') uncertain.push('The size comes from public unlock trackers, not from the headline, and trackers can differ.');
  if (pct == null && tp != null) uncertain.push('How many coins already trade is not stated.');
  uncertain.push(NO_CASES);
  return {
    what,
    why: 'More coins on the market with the same buyers usually means the price has to work harder to stay where it is. Early investors who got cheap coins may want to cash some out.',
    scenarios: [
      sc('down', 'Price drifts lower as the new coins reach the market.', '1–7 days', 'More likely if the coins go to early investors, not a locked treasury.', `Exchange deposits of ${T} rise and the price lags BTC.`),
      sc('up', 'Buyers were waiting and absorb the coins.', '1–7 days', 'More likely if the project announced buybacks or the unlock was known for weeks.', 'The price holds its pre-news level while BTC is flat.'),
      sc('chop', 'Big moves both ways while traders guess.', 'first 48 hours', 'More likely when volatility is already high.', RANGE),
    ],
    tradeoffs: 'Early holders get the freedom to trade their coins; everyone else holds a bigger pile of coins than yesterday.',
    affected: [
      a('Investors receiving coins', 'They can now trade what was locked.'),
      a('Current holders', 'More supply is around than before.'),
      a('The exchange', 'More trading activity is likely.'),
    ],
    watch: [
      w('Does the price hold the level it had before the unlock news?', 'Compare today\'s price with the price just before the headline.'),
      w('Who receives the coins?', 'Look for the project or the unlock calendar naming the receiving group.'),
      w(`Is ${T} weaker or stronger than BTC this week?`, `Put ${T} and BTC side by side on the same chart.`),
    ],
    uncertain,
    glossary: ['circulating supply', 'cliff unlock'],
  };
}

// ---------------------------------------------------------------- hack / exploit / depeg / halt
function theft(f) {
  const P = f.project || f.ticker || 'A project';
  const src = f.source || 'the source';
  const d = dateOf(f);
  const amt = f.amount_usd != null ? `about ${fmtUsd(f.amount_usd)}` : 'an amount that is not yet confirmed';
  return {
    what: `${P} lost ${amt} to a hacker${on(d)}, reported by ${src}.`,
    why: 'Money is gone, trust is hurt, and stolen coins may be moved onto the market.',
    scenarios: [
      sc('down', 'Price falls as trust drops and stolen coins may reach the market.', 'hours–3 days', 'More likely if the loss is large compared with what the project holds.', 'The team confirms the loss and users rush to withdraw.'),
      sc('up', 'The loss is covered or the funds are frozen, and the price recovers.', 'days–weeks', 'More likely if the team covers the loss or exchanges freeze the funds.', 'An official post announces recovered funds or a refund plan.'),
      sc('chop', 'Price swings both ways while details are unclear.', 'first day', 'More likely while the exact loss is unconfirmed.', RANGE),
    ],
    tradeoffs: 'Pausing the system protects what is left but locks users out meanwhile.',
    affected: [
      a('Users with funds inside', 'Their coins may be locked or lost.'),
      a('The token\'s holders', 'Trust in the project is hit.'),
      a('Exchanges', 'They may freeze deposits of the affected coin.'),
    ],
    watch: [
      w('Does the team confirm the number?', 'Look for an official post with the exact loss.'),
      w('Are stolen coins moving to exchanges?', 'On-chain trackers show where the stolen coins go.'),
      w('Is there a refund or pause plan?', 'Check the project\'s official channels.'),
    ],
    uncertain: ['Exact loss not yet confirmed by the team.', NO_CASES],
    glossary: ['exploit', 'stolen funds'],
  };
}
function exploit(f) {
  const P = f.project || f.ticker || 'A project';
  const src = f.source || 'the source';
  const d = dateOf(f);
  const amt = f.amount_usd != null ? ` Reports mention about ${fmtUsd(f.amount_usd)}.` : '';
  return Object.assign(theft(f), {
    what: `${P} reported a security problem in its code${on(d)}, according to ${src}.${amt}`,
    why: 'A flaw in the code can let someone take funds or break the rules of the system. Until it is fixed, users are exposed.',
    scenarios: [
      sc('down', 'Price falls while the size of the problem is unknown.', 'hours–3 days', 'More likely if funds were taken or the fix is not ready.', 'The team confirms a loss or pauses the system.'),
      sc('up', 'The flaw is fixed quickly and nothing is lost.', 'days–weeks', 'More likely if the team patches it fast and no funds moved.', 'An official post says the issue is closed and funds are safe.'),
      sc('chop', 'Price swings both ways while details are unclear.', 'first day', 'More likely while the cause is unconfirmed.', RANGE),
    ],
    uncertain: ['The size of the problem is not yet confirmed by the team.', NO_CASES],
    glossary: ['exploit'],
  });
}
function depeg(f) {
  const T = f.ticker || 'This coin';
  const src = f.source || 'the source';
  const p = f.peg_usd != null ? `$${f.peg_usd}` : 'its promised price';
  return {
    what: `${T} is meant to stay at ${p}. Right now it is below that, according to ${src}.`,
    why: `A stablecoin is only useful if people believe it is worth ${p}. When that belief cracks, many want out at once.`,
    scenarios: [
      sc('up', `It returns to ${p}.`, 'days', 'More likely if the issuer shows reserves and redemptions work.', 'The coin stays at its promised price for a full day.'),
      sc('down', 'It stays below its promised price.', 'days–weeks', 'More likely if redemptions are paused or reserves are questioned.', 'The gap to the promised price does not close.'),
      sc('chop', 'It wobbles around its promised price while people wait for news.', 'first day', 'More likely if the issuer stays quiet.', 'The coin keeps crossing its promised price.'),
    ],
    tradeoffs: 'Pausing redemptions protects the reserves but stops holders from leaving.',
    affected: [
      a('Holders of the coin', 'What they hold is worth less than promised.'),
      a('Traders and lenders using it', 'They may be forced to close positions.'),
      a('The issuer', 'Its reserves and promises are being tested.'),
    ],
    watch: [
      w(`Can people redeem for ${p}?`, 'Check the issuer\'s redemption page and recent posts.'),
      w('What does the issuer say?', 'Look for an official statement.'),
      w('Is it one exchange or everywhere?', 'Compare prices on several exchanges.'),
    ],
    uncertain: ['The cause of the drop is not confirmed.', NO_CASES],
    glossary: ['stablecoin', 'peg'],
  };
}
function halt(f) {
  const who = f.exchange || f.project || f.ticker || 'A platform';
  const what = f.what_paused || 'some services';
  const d = dateOf(f);
  return {
    what: `${who} paused ${what}${on(d)}.`,
    why: 'When you cannot move your coins, people get nervous and move to other places.',
    scenarios: [
      sc('up', 'Services reopen soon and things calm down.', 'hours–days', 'More likely if the reason is a routine fix.', 'The team posts a reopening time and it is met.'),
      sc('down', 'Worry spreads and people move coins elsewhere.', 'days', 'More likely if no reason is given.', 'The pause is extended or the reason stays unclear.'),
      sc('chop', 'Price swings while nobody knows when it reopens.', 'first day', 'More likely if the reopening time is unknown.', RANGE),
    ],
    tradeoffs: 'A pause protects funds from further damage but locks users out while it lasts.',
    affected: [
      a('Users who want to move coins', 'They are stuck until services reopen.'),
      a('Traders on the platform', 'They cannot adjust positions.'),
      a('Other platforms', 'They may see extra activity.'),
    ],
    watch: [
      w('When do withdrawals reopen?', 'Look for an official time from the platform.'),
      w('Is the reason explained?', 'Check the platform\'s announcement.'),
      w('Are other exchanges still working?', 'Compare with other exchanges.'),
    ],
    uncertain: ['The reason and the length of the pause are not confirmed.', NO_CASES],
    glossary: ['withdrawals paused'],
  };
}

// ---------------------------------------------------------------- listing / delisting
function listing(f) {
  const T = f.ticker || 'this coin';
  const X = f.exchange || 'An exchange';
  const m = f.market ? ` (${f.market})` : '';
  return {
    what: `${X} will list ${T}${m}${on(f.event_date_et)}.`,
    why: 'A big exchange brings new buyers, but many traders trade the rumour and leave on listing day.',
    scenarios: [
      sc('up', 'Interest continues after the first day.', 'days', 'More likely if trading volume stays high after the first day.', 'Volume on the second day stays close to the first.'),
      sc('down', 'Price fades after the early jump.', 'days', 'More likely if the price already jumped before the announcement.', 'Volume drops sharply on the second day.'),
      sc('chop', 'Big moves both ways around listing time.', 'first day', 'More likely when the coin is thinly traded.', RANGE),
    ],
    tradeoffs: 'New buyers get access; early holders get a place to cash out.',
    affected: [
      a('New buyers', 'They gain easy access to the coin.'),
      a('Early holders', 'They gain liquidity.'),
      a('The exchange', 'It earns trading fees.'),
    ],
    watch: [
      w('Volume on the second day vs the first', 'Compare the two days on the exchange.'),
      w('Did the price already jump before the announcement?', 'Look at the chart just before the headline.'),
      w(`Is ${T} listed anywhere else?`, 'Check other exchanges.'),
    ],
    uncertain: ['The exact start time may still change.', NO_CASES],
    glossary: ['listing', 'liquidity'],
  };
}
function delisting(f) {
  const T = f.ticker || 'this coin';
  const X = f.exchange || 'An exchange';
  const m = f.market ? ` (${f.market})` : '';
  const last = (f.restrictions || []).find((r) => r.kind === 'delist_date');
  return {
    what: `${X} will delist ${T}${m}${last ? ` after ${last.when_et}` : ''}.`,
    why: 'When a big exchange removes a coin, fewer people can trade it and some holders move out early.',
    scenarios: [
      sc('down', 'Price falls as holders move out before the last day.', 'days', 'More likely if the coin has few other places to trade.', 'Trading volume falls on the other exchanges too.'),
      sc('up', 'The news was expected and the price holds.', 'days', 'More likely if the coin trades well elsewhere.', 'The price holds its pre-news level while BTC is flat.'),
      sc('chop', 'Big moves both ways around the last trading day.', 'around the last day', 'More likely if the last day is close.', RANGE),
    ],
    tradeoffs: 'The exchange reduces risk for itself; holders on that exchange must act or move their coins.',
    affected: [
      a('Holders on that exchange', 'They must move or trade out before the deadline.'),
      a('Traders of the pair', 'Their market disappears.'),
      a('The project', 'It loses a major place to trade.'),
    ],
    watch: [
      w('The last trading date', 'Read the exchange notice for the exact date.'),
      w('Where else it trades', 'List the other exchanges that carry it.'),
      w('Does the project respond?', 'Check the project\'s official channels.'),
    ],
    uncertain: ['Whether the coin returns later is unknown.', NO_CASES],
    glossary: ['delisting', 'liquidity'],
  };
}

// ---------------------------------------------------------------- regulatory / etf / macro
function reg(kind) {
  return function (f) {
    const body = f.body || 'A regulator';
    const scope = f.ticker ? f.ticker : 'the whole market';
    const dl = (f.restrictions || []).find((r) => r.kind === 'decision_deadline');
    const next = dl ? ` Next step: ${dl.detail.toLowerCase()} ${dl.when_et}.` : '';
    const etf = kind === 'etf';
    const head = String(f.headline || '').replace(/[.\s]+$/, '');
    return {
      what: `${etf ? 'ETF news' : 'News from ' + body}: ${head}.`,
      why: `Rules decide who is allowed to hold and trade crypto. This touches ${scope}, not one project.`,
      scenarios: [
        sc('up', 'Relief: the news is read as good for the market.', 'days–weeks', `More likely if the details are friendlier than expected.${next}`, 'Prices hold or rise while other rules news is quiet.'),
        sc('down', 'Pressure: the news is read as a new obstacle.', 'days–weeks', `More likely if the details add new limits.${next}`, 'Prices fall and other regulators repeat the message.'),
        sc('chop', 'Wait-and-see until the next step is clear.', 'first days', 'More likely if key details are still missing.', 'The day\'s price range stays wide without a clear direction.'),
      ],
      tradeoffs: 'Clear rules protect users but can limit what products and people are allowed.',
      affected: [
        a(f.ticker ? `Holders of ${f.ticker}` : 'Crypto holders', 'Rules change what they can do.'),
        a('Exchanges and issuers', 'They must follow the new rule or decision.'),
        a('Large investors', 'They look for clarity before acting.'),
      ],
      watch: [
        w('Is there a date for the next decision?', 'Look for a dated next step in the announcement.'),
        w('Did other regulators react?', 'Search for similar statements from other countries.'),
        w('Is this new or a repeat?', 'Check whether the same news appeared earlier.'),
      ],
      uncertain: ['The full details have not been confirmed by every source.', NO_CASES],
      glossary: etf ? ['ETF', 'regulation'] : ['regulation'],
    };
  };
}

const TABLE = {
  'unlock:supply_shock': unlock,
  'hack:theft': theft,
  'hack:exploit': exploit,
  'hack:depeg': depeg,
  'hack:halt': halt,
  'regulatory:halt': halt,
  'listing:top_exchange': listing,
  'delisting:top_exchange': delisting,
  'etf:bullish': reg('etf'),
  'etf:bearish': reg('etf'),
  'etf:neutral': reg('etf'),
  'regulatory:bull': reg('reg'),
  'regulatory:bear': reg('reg'),
  'regulatory:macro': reg('reg'),
};

function render(category, subtype, facts) {
  const fn = TABLE[category + ':' + subtype];
  if (!fn) throw new Error('no template for ' + category + ':' + subtype);
  const t = fn(facts);
  t.source = 'template';
  t.rewriteInfo = null;
  return t;
}

module.exports = { render, fmtCount, fmtUsd, TABLE };
