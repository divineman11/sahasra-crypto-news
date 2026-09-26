const INSTRUMENTS = [
  { ticker: 'BTC', name: 'Bitcoin', keywords: ['bitcoin', 'btc', 'satoshi'] },
  { ticker: 'ETH', name: 'Ethereum', keywords: ['ethereum', 'ether', 'vitalik'] },
  { ticker: 'SOL', name: 'Solana', keywords: ['solana', 'sol'] },
  { ticker: 'BNB', name: 'BNB', keywords: ['bnb', 'binance coin'] },
  { ticker: 'XRP', name: 'XRP', keywords: ['xrp', 'ripple'] },
  { ticker: 'DOGE', name: 'Dogecoin', keywords: ['dogecoin', 'doge'] },
  { ticker: 'ADA', name: 'Cardano', keywords: ['cardano', 'ada'] },
  { ticker: 'AVAX', name: 'Avalanche', keywords: ['avalanche', 'avax'] },
  { ticker: 'LINK', name: 'Chainlink', keywords: ['chainlink', 'link'] },
  { ticker: 'TON', name: 'Toncoin', keywords: ['toncoin', 'ton'] },
  { ticker: 'DOT', name: 'Polkadot', keywords: ['polkadot', 'dot'] },
  { ticker: 'MATIC', name: 'Polygon', keywords: 'polygon matic'.split(' ') },
  { ticker: 'LTC', name: 'Litecoin', keywords: ['litecoin', 'ltc'] },
  { ticker: 'TRX', name: 'TRON', keywords: ['tron', 'trx'] },
  { ticker: 'SHIB', name: 'Shiba Inu', keywords: ['shiba inu', 'shib'] },
  { ticker: 'UNI', name: 'Uniswap', keywords: ['uniswap', 'uni'] },
  { ticker: 'ATOM', name: 'Cosmos', keywords: ['cosmos', 'atom'] },
  { ticker: 'XLM', name: 'Stellar', keywords: ['stellar', 'xlm'] },
  { ticker: 'NEAR', name: 'NEAR Protocol', keywords: ['near protocol', 'near'] },
  { ticker: 'APT', name: 'Aptos', keywords: ['aptos', 'apt'] },
  { ticker: 'ARB', name: 'Arbitrum', keywords: ['arbitrum', 'arb'] },
  { ticker: 'OP', name: 'Optimism', keywords: ['optimism', 'op'] },
  { ticker: 'SUI', name: 'Sui', keywords: ['sui'] },
  { ticker: 'PEPE', name: 'Pepe', keywords: ['pepe'] },
  { ticker: 'INJ', name: 'Injective', keywords: ['injective', 'inj'] },
  { ticker: 'FIL', name: 'Filecoin', keywords: ['filecoin', 'fil'] },
  { ticker: 'AAVE', name: 'Aave', keywords: ['aave'] },
  { ticker: 'MKR', name: 'Maker', keywords: ['maker', 'mkr'] },
  { ticker: 'RNDR', name: 'Render', keywords: ['render', 'rndr'] },
  { ticker: 'TIA', name: 'Celestia', keywords: ['celestia', 'tia'] },
];

function extractTickers(title) {
  const lower = ' ' + String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  const found = [];
  for (const inst of INSTRUMENTS) {
    const terms = [inst.ticker.toLowerCase(), inst.name.toLowerCase(), ...inst.keywords];
    if (terms.some((kw) => lower.includes(' ' + kw.toLowerCase() + ' '))) {
      found.push(inst.ticker);
      if (found.length >= 3) break;
    }
  }
  return [...new Set(found)].slice(0, 3);
}

module.exports = { INSTRUMENTS, extractTickers };