'use strict';

const path = require('path');
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';
const SEC_UA = process.env.SEC_USER_AGENT || '';
const DISCORD_WEBHOOK = process.env.DISCORD_NEWS_WEBHOOK || '';
const PORTFOLIO = (process.env.NEWS_PORTFOLIO || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
// Default output: a JSON summary of recent per-coin news (app/news_live.json), for scripting/export.
const NEWS_LIVE_JSON = process.env.NEWS_LIVE_JSON || path.join(__dirname, '..', 'news_live.json');
const KEEP_DAYS = 7;

// Regulator feeds are general; keep only crypto-related press releases.
const CRYPTO_FILTER = '\\b(crypto|bitcoin|ether(eum)?\\b|digital asset|stablecoin|blockchain|tokens?\\b|tokeni[sz]ed\\b|tokeni[sz]ation\\b|virtual currenc|defi\\b|decentrali[sz]ed finance|mixer|NFT)';
const BSKY_FILTER = CRYPTO_FILTER + '|' + '\\b(BTC|ETH|SOL|XRP|USDT|USDC|Tether|Circle|Coinbase|Binance|Kraken|Bitget|Bybit|OKX|FTX|SBF|Bankman|Celsius|Do Kwon|Tornado|Roman Storm|Samourai|SEC|CFTC|Gensler|Atkins|Peirce|GENIUS Act|Clarity Act|MiCA|ETFs?|Saylor|MicroStrategy|treasury compan(y|ies)|miners?|mining|halving|hashrate|Lightning|Knots|Bitcoin Core|Solana|Ripple|Cardano|Dogecoin|memecoins?|airdrops?|rug ?pull|exploit(ed|s)?|hack(ed|er|ers|s)?|drain(ed|er)?|bridge|validators?|staking|restaking|rollups?|L2s?|zk|zero-knowledge|mainnet|smart contracts?|wallets?|self-custody|custod(y|ian)|on-?chain|DAO|Web3|Zcash|Monero|privacy coin|prediction markets?|Polymarket|Kalshi|Ponzi|pig[- ]butchering|money launder\\w*|OFAC|FinCEN|Vitalik|Ethereum Foundation|geth|Uniswap|Aave|Lido|MakerDAO|Hyperliquid|perps?|liquidat\\w+|whale)\\b';

const RSS_FEEDS = [
  { name: 'rss:cointelegraph', url: 'https://cointelegraph.com/rss', domain: 'cointelegraph.com' },
  { name: 'rss:theblock', url: 'https://www.theblock.co/rss.xml', domain: 'theblock.co' },
  { name: 'rss:decrypt', url: 'https://decrypt.co/feed', domain: 'decrypt.co' },
  { name: 'rss:coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', domain: 'coindesk.com' },
  { name: 'rss:cryptoslate', url: 'https://cryptoslate.com/feed/', domain: 'cryptoslate.com' },
  { name: 'rss:beincrypto', url: 'https://beincrypto.com/feed/', domain: 'beincrypto.com' },
  { name: 'rss:bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed', domain: 'bitcoinmagazine.com' },
  { name: 'rss:cryptopotato', url: 'https://cryptopotato.com/feed/', domain: 'cryptopotato.com' },
  { name: 'rss:newsbtc', url: 'https://www.newsbtc.com/feed/', domain: 'newsbtc.com' },
  { name: 'rss:bitcoinist', url: 'https://bitcoinist.com/feed/', domain: 'bitcoinist.com' },
  { name: 'rss:cryptobriefing', url: 'https://cryptobriefing.com/feed/', domain: 'cryptobriefing.com' },
  { name: 'rss:ambcrypto', url: 'https://ambcrypto.com/feed/', domain: 'ambcrypto.com' },
  { name: 'rss:utoday', url: 'https://u.today/rss', domain: 'u.today', maxItems: 40 },
  { name: 'rss:dailyhodl', url: 'https://dailyhodl.com/feed/', domain: 'dailyhodl.com' },
  { name: 'rss:cryptonews', url: 'https://cryptonews.com/news/feed/', domain: 'cryptonews.com' },
  { name: 'rss:protos', url: 'https://protos.com/feed/', domain: 'protos.com' },
  { name: 'rss:thedefiant', url: 'https://thedefiant.io/feed', domain: 'thedefiant.io', maxItems: 40 },
  { name: 'rss:unchained', url: 'https://unchainedcrypto.com/feed/', domain: 'unchainedcrypto.com' },
  { name: 'rss:coinjournal', url: 'https://coinjournal.net/feed/', domain: 'coinjournal.net' },
  { name: 'rss:cryptonewsnet', url: 'https://crypto.news/feed/', domain: 'crypto.news' },
  { name: 'rss:coingape', url: 'https://coingape.com/feed/', domain: 'coingape.com' },
  { name: 'rss:cryptopolitan', url: 'https://www.cryptopolitan.com/feed/', domain: 'cryptopolitan.com' },
  { name: 'rss:finbold', url: 'https://finbold.com/feed/', domain: 'finbold.com' },
  { name: 'rss:coinpedia', url: 'https://coinpedia.org/feed/', domain: 'coinpedia.org' },
  { name: 'rss:watcherguru', url: 'https://watcher.guru/news/feed', domain: 'watcher.guru' },
  { name: 'rss:bitcoincom', url: 'https://news.bitcoin.com/feed/', domain: 'news.bitcoin.com' },
  { name: 'rss:invezz', url: 'https://invezz.com/news/cryptocurrency/feed/', domain: 'invezz.com' },
  { name: 'rss:99bitcoins', url: 'https://99bitcoins.com/feed/', domain: '99bitcoins.com', intervalMs: 600000 },
  { name: 'rss:zycrypto', url: 'https://zycrypto.com/feed/', domain: 'zycrypto.com' },
  { name: 'rss:thecryptobasic', url: 'https://thecryptobasic.com/feed/', domain: 'thecryptobasic.com' },
  { name: 'rss:tokenpost', url: 'https://tokenpost.com/rss', domain: 'tokenpost.com', maxItems: 40 },
  { name: 'rss:blockchainnews', url: 'https://blockchain.news/rss', domain: 'blockchain.news', maxItems: 40 },
  { name: 'rss:coinspeaker', url: 'https://www.coinspeaker.com/feed/', domain: 'coinspeaker.com' },
  { name: 'rss:cryptonomist', url: 'https://en.cryptonomist.ch/feed/', domain: 'en.cryptonomist.ch' },
  { name: 'rss:thenewscrypto', url: 'https://thenewscrypto.com/feed/', domain: 'thenewscrypto.com' },
  { name: 'rss:bravenewcoin', url: 'https://bravenewcoin.com/feed', domain: 'bravenewcoin.com' },
  { name: 'rss:coincentral', url: 'https://coincentral.com/feed/', domain: 'coincentral.com' },
  { name: 'rss:coinedition', url: 'https://coinedition.com/feed/', domain: 'coinedition.com' },
  { name: 'rss:cnbc-crypto', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', domain: 'cnbc.com' },
  { name: 'rss:fxstreet-crypto', url: 'https://www.fxstreet.com/rss/crypto', domain: 'fxstreet.com' },
  { name: 'rss:bloomberg-crypto', url: 'https://feeds.bloomberg.com/crypto/news.rss', domain: 'bloomberg.com', intervalMs: 300000 },
  { name: 'reg:cftc', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', domain: 'cftc.gov', tier: 2, kind: 'regulator', titlePrefix: '[CFTC] ', filter: CRYPTO_FILTER, intervalMs: 300000 },
  { name: 'reg:fed', url: 'https://www.federalreserve.gov/feeds/press_all.xml', domain: 'federalreserve.gov', tier: 2, kind: 'regulator', titlePrefix: '[Fed] ', filter: CRYPTO_FILTER, intervalMs: 300000 },
  { name: 'reg:doj', url: 'https://www.justice.gov/news/rss?type=press_release', domain: 'justice.gov', tier: 2, kind: 'regulator', titlePrefix: '[DOJ] ', filter: CRYPTO_FILTER, intervalMs: 300000 },
  { name: 'reg:ecb', url: 'https://www.ecb.europa.eu/rss/press.html', domain: 'ecb.europa.eu', tier: 2, kind: 'regulator', titlePrefix: '[ECB] ', filter: CRYPTO_FILTER, intervalMs: 300000 },
  { name: 'blog:chainalysis', url: 'https://www.chainalysis.com/blog/feed/', domain: 'chainalysis.com', intervalMs: 600000 },
  { name: 'blog:ethereum', url: 'https://blog.ethereum.org/en/feed.xml', domain: 'blog.ethereum.org', maxItems: 20, intervalMs: 600000 },
  { name: 'blog:solana', url: 'https://solana.com/news/rss.xml', domain: 'solana.com', intervalMs: 600000 },
];

// Generalized t.me/s/<channel> wire adapters (app/ingest/adapters/telegram.js).
// Macro terms that move crypto markets even though the headline itself has no crypto word
// (Walter_Bloomberg mixes crypto with general macro/TradFi headlines). Wide recall (plurals,
// "federal reserve", "treasur(y|ies)", yields/payrolls/PCE/GDP/inflation/jobless claims) — every
// term is \b-bounded so it never substring-matches inside an unrelated word (e.g. \bFed\b
// correctly does not match "FEDEX").
const MACRO_FILTER = '\\b(Fed|FOMC|CPI|rate (cut|hike)s?|Powell|federal reserve|treasur(y|ies)|SEC|ETF|tariffs?|yields?|payrolls?|PCE|GDP|inflation|jobless claims)\\b';
// Only BWEnews (its own dedicated adapter, unaffected by this list) is a confirmed-live source;
// the other wire channels are curated but unverified — `verified: false` (the default when
// omitted) makes their adapter `quietHealth: true` in telegram.js, same treatment as an
// unverified officialSources.json entry (see official.js / health.js / scheduler.js).
// The 4 tier-2 wires use 120s so t.me's total request rate across all wire channels drops from
// 7.5 to 5.5 req/min, making tg:bwenews (tier 1, its own dedicated adapter, 30s) less likely to
// be throttled by t.me alongside them.
const TG_CHANNELS = [
  { channel: 'TreeNewsFeed', tier: 2, intervalMs: 120000, verified: false },
  { channel: 'Walter_Bloomberg', tier: 2, intervalMs: 120000, filter: CRYPTO_FILTER + '|' + MACRO_FILTER, verified: false },
  { channel: 'WatcherGuru', tier: 2, intervalMs: 120000, verified: false },
  { channel: 'wublockchainenglish', tier: 2, intervalMs: 120000, verified: false },
  { channel: 'whale_alert_io', tier: 4, intervalMs: 120000, alertable: false, maxImportance: 10, verified: false },
];

// YouTube channel Atom feeds (verified:false until a feed has proven reliable from this network).
const YT_CHANNELS = [
  { slug: 'coinbureau', name: 'Coin Bureau', channelId: 'UCqK_GSMbpiV8spgD3ZGloSw', verified: false },
  { slug: 'bankless', name: 'Bankless', channelId: 'UCAl9Ld79qaZxp9JzEOwd3aA', verified: false },
  { slug: 'thedefiant', name: 'The Defiant', channelId: 'UCL0J4MLEdLP0-UyLu0hCktg', verified: false },
  { slug: 'altcoindaily', name: 'Altcoin Daily', channelId: 'UCbLhGKVY-bJPcawebgtNfbw', verified: false },
  { slug: 'investanswers', name: 'InvestAnswers', channelId: 'UClgJyzwGs-GyaNxUHcLZrkg', verified: false },
  { slug: 'pomp', name: 'Pomp', channelId: 'UCevXpeL8cNyAnww-NqJ4m2w', verified: false },
  { slug: 'coindesk', name: 'CoinDesk', channelId: 'UC7TghOL755nBk7HelHoi9LQ', verified: false },
  { slug: 'bitcoinmagazine', name: 'Bitcoin Magazine', channelId: 'UCtOV5M-T3GcsJAq8QKaf0lg', verified: false },
  { slug: 'realvision', name: 'Real Vision', channelId: 'UCGXWKlq1Oxr3ddEtmKhAkPg', verified: false },
  { slug: 'cryptobanter', name: 'Crypto Banter', channelId: 'UCN9Nj4tjXbVTLYWN0EKly_Q', verified: false },
  { slug: 'datadash', name: 'DataDash', channelId: 'UCCatR7nWbYrkVXdxXb4cGXw', verified: false },
  { slug: 'theblock', name: 'The Block', channelId: 'UCqjFueYMJ78eF6G0lGLzzpQ', verified: false },
  { slug: 'paulbarron', name: 'Paul Barron', channelId: 'UC4VPa7EOvObpyCRI4YKRQRw', verified: false },
  { slug: 'unchained', name: 'Unchained', channelId: 'UCWiiMnsnw5Isc2PP1to9nNw', verified: false },
];

// Curated Bluesky accounts. DID is the identity — re-check handles if a URL 404s; filter:false only for accounts that are 100 % crypto.
const BSKY_ACCOUNTS = [
  { slug: 'caspiancey',  handle: 'cascoinfoundation.org',                    did: 'did:plc:gujnzolp2n4upahg3zb6u6zx', name: 'Cas Piancey' },
  { slug: 'bft',         handle: 'bft.wtf',                                  did: 'did:plc:qyqbfjkwwohghps2bbknj4ni', name: 'Bennett Tomlin' },
  { slug: 'mollywhite',  handle: 'molly.wiki',                               did: 'did:plc:exrxvyu6bpoym6mbnctke5tn', name: 'Molly White' },
  { slug: 'w3igg',       handle: 'web3isgoinggreat.com',                     did: 'did:plc:ugyl6syayvsrvu5w4uxtlkz4', name: 'Web3 Is Going Just Great', filter: false },
  { slug: 'davidgerard', handle: 'davidgerard.circumstances.run.ap.brid.gy', did: 'did:plc:g4zvqebem5mso7y2osno5o43', name: 'David Gerard' },
  { slug: 'csfrayer',    handle: 'csfrayer.bsky.social',                     did: 'did:plc:yjcrm7o57q2hk7lixizk5tb7', name: 'Corey Frayer' },
  { slug: 'hilaryallen', handle: 'profhilaryallen.bsky.social',              did: 'did:plc:4bcrv573bktwj6xw5tie2im5', name: 'Hilary Allen' },
  { slug: 'silverman',   handle: 'jacobsilverman.com',                       did: 'did:plc:ijngmewyhu76j3aetbulfov7', name: 'Jacob Silverman' },
  { slug: 'zekefaux',    handle: 'zekefaux.bsky.social',                     did: 'did:plc:om5px6rmhsd2mkqul2hjzsw5', name: 'Zeke Faux' },
  { slug: 'benmckenzie', handle: 'benmckenzie.bsky.social',                  did: 'did:plc:eqkd2r3hrbgotsawtwqztnre', name: 'Ben McKenzie' },
  { slug: 'dzmorris',    handle: 'davidzmorris.bsky.social',                 did: 'did:plc:lkmrmadl4fpy2s72emscmxgr', name: 'David Z. Morris' },
  { slug: 'nikde',       handle: 'nikhileshde.bsky.social',                  did: 'did:plc:yjlivmqh63ohzgklvioiby4w', name: 'Nikhilesh De' },
  { slug: 'pstafford',   handle: 'staffordphilip.bsky.social',               did: 'did:plc:hnnp3pc5eprmczrv5no5thgg', name: 'Philip Stafford' },
  { slug: 'moneystuff',  handle: 'matt-levine.bsky.social',                  did: 'did:plc:hthhtetujklon2c7r65cmvrq', name: 'Money Stuff' },
  { slug: 'vitalik',     handle: 'vitalik.ca',                               did: 'did:plc:qmajrxvehl6ss6w2h4uuv5bg', name: 'Vitalik Buterin' },
  { slug: 'karalabe',    handle: 'karalabe.bsky.social',                     did: 'did:plc:if2tug5buc5a3crz2d2i24i3', name: 'Péter Szilágyi' },
  { slug: 'edmundedgar', handle: 'goat.navy',                                did: 'did:plc:pyzlzqt6b2nyrha7smfry6rv', name: 'Edmund Edgar' },
  { slug: 'web3privacy', handle: 'web3privacy.info',                         did: 'did:plc:3sfk2lroe4a5lm6yr3qxzd3s', name: 'Web3Privacy Now' },
  { slug: 'zfnd',        handle: 'zfnd.org',                                 did: 'did:plc:z7q7hx2lk3s2hpzjcpxfkre4', name: 'Zcash Foundation', filter: false },
  { slug: 'lukedashjr',  handle: 'lukedashjr.bsky.social',                   did: 'did:plc:lggtzy2odpnrgizsir4gejsw', name: 'Luke Dashjr', filter: false },
  { slug: 'btcbreakdown',handle: 'btcbreakdown.com',                         did: 'did:plc:xufmktwgylcyqth7yeoihm2l', name: 'Bitcoin Breakdown', filter: false },
];

// Reddit Social tab. OAuth mode (minScore gate) when REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD are set;
// otherwise ONE keyless multireddit /hot/.rss request every 10 min, keeping the first rssTake posts per sub.
const REDDIT_SUBS = [
  { sub: 'CryptoCurrency', minScore: 150, rssTake: 10 },
  { sub: 'CryptoMarkets', minScore: 50, rssTake: 8 },
  { sub: 'Bitcoin', minScore: 100, rssTake: 10 },
  { sub: 'ethereum', minScore: 50, rssTake: 6 },
  { sub: 'solana', minScore: 50, rssTake: 6 },
  { sub: 'defi', minScore: 30, rssTake: 5 },
];

module.exports = { BROWSER_UA, SEC_UA, DISCORD_WEBHOOK, PORTFOLIO, NEWS_LIVE_JSON, KEEP_DAYS, CRYPTO_FILTER, BSKY_FILTER, RSS_FEEDS, MACRO_FILTER, TG_CHANNELS, YT_CHANNELS, BSKY_ACCOUNTS, REDDIT_SUBS };