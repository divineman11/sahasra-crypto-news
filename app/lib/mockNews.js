const { INSTRUMENTS, extractTickers } = require('./instruments');

const SOURCES = [
  'coindesk.com',
  'cointelegraph.com',
  'theblock.co',
  'decrypt.co',
  'bloomberg.com',
  'reuters.com',
  'cryptoslate.com',
  'bitcoinmagazine.com',
  'u.today',
  'x.com',
];

// {tag} where tag: positive|negative|neutral
const TEMPLATES = [
  { t: '{NAME} surges {N}% as ETF inflows hit record', s: 'positive', r: [3, 18] },
  { t: 'Whale moves ${N}M in {COIN} to exchange', s: 'neutral', r: [20, 600] },
  { t: 'SEC delays decision on {NAME} ETF', s: 'negative' },
  { t: '{NAME} network upgrade goes live on mainnet', s: 'positive' },
  { t: 'Analysts: {NAME} could rally {N}% this quarter', s: 'positive', r: [10, 60] },
  { t: '{COIN} slides {N}% amid broader market selloff', s: 'negative', r: [3, 15] },
  { t: 'Major exchange lists {NAME} perpetual futures', s: 'positive' },
  { t: '{NAME} developer activity hits all-time high', s: 'positive' },
  { t: 'Regulators open probe into {NAME} foundation', s: 'negative' },
  { t: '{N}M users onboarded to {NAME} ecosystem this month', s: 'positive', r: [1, 12] },
  { t: '{COIN} whale wallet wakes up after 5 years of dormancy', s: 'neutral' },
  { t: 'Institutional investors dump {N}M of {COIN}', s: 'negative', r: [50, 900] },
  { t: '{NAME} validators approve governance proposal', s: 'neutral' },
  { t: 'Breaking: {NAME} partnership with global payments giant', s: 'positive' },
  { t: '{COIN} funding rates flip negative as leverage unwinds', s: 'negative' },
  { t: '{NAME} TVL climbs {N}% week over week', s: 'positive', r: [4, 35] },
  { t: 'Report: {N}% of {NAME} supply held by top 100 wallets', s: 'neutral', r: [30, 70] },
  { t: 'Exchange outage sparks {COIN} flash crash', s: 'negative' },
  { t: '{NAME} core devs ship critical security patch', s: 'neutral' },
  { t: 'Fidelity files for spot {NAME} trust', s: 'positive' },
  { t: '{COIN} open interest hits record ${N}M', s: 'positive', r: [300, 2500] },
  { t: 'Whales accumulate {N}M worth of {COIN} in 48 hours', s: 'positive', r: [15, 400] },
  { t: 'Court ruling complicates {NAME} regulatory status', s: 'negative' },
  { t: '{NAME} layer-2 throughput doubles after fork', s: 'positive' },
  { t: 'Short sellers target {COIN} after weak volume', s: 'negative' },
  { t: '{NAME} staking yields surpass {N}% annually', s: 'positive', r: [3, 12] },
  { t: 'Audit finds no critical flaws in {NAME} smart contracts', s: 'neutral' },
  { t: 'Liquidation cascade wipes ${N}M in {COIN} longs', s: 'negative', r: [40, 800] },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

function randHex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function makeArticle(publishedAt) {
  const tpl = pick(TEMPLATES);
  const coin = pick(INSTRUMENTS);
  const n = tpl.r ? randInt(tpl.r[0], tpl.r[1]) : 0;
  const title = tpl.t
    .replace(/\{NAME\}/g, coin.name)
    .replace(/\{COIN\}/g, coin.ticker)
    .replace(/\{N\}/g, String(n));

  let tickers = extractTickers(title);
  if (tickers.length < 1) tickers.push(coin.ticker);
  tickers = [...new Set(tickers)].slice(0, 3);

  const sourceDomain = pick(SOURCES);
  const kind =
    sourceDomain === 'x.com' ? 'media' : sourceDomain === 'bitcoinmagazine.com' ? 'blog' : 'news';
  const sentiment =
    tpl.s === 'positive' ? 'bullish' : tpl.s === 'negative' ? 'bearish' : 'neutral';
  const url = `https://news.local/${sourceDomain}/${slugify(title)}-${randHex(8)}`;

  const votes = {
    bullish: randInt(0, 5),
    bearish: randInt(0, 4),
    important: randInt(0, 2),
    toxic: randInt(0, 1),
  };

  return { title, url, sourceDomain, publishedAt, kind, sentiment, tickers, votes };
}

module.exports = { makeArticle };