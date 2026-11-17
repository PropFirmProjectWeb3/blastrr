const USD_CONVERSION_SYMBOLS = Object.freeze({
  EUR: 'FX:EURUSD',
  GBP: 'FX:GBPUSD',
  AUD: 'FX:AUDUSD',
  NZD: 'FX:NZDUSD',
  JPY: 'FX:USDJPY',
  CHF: 'FX:USDCHF',
  CAD: 'FX:USDCAD'
});

function getQuoteToUsdRate(quoteCurrency, pricesBySymbol) {
  const currency = String(quoteCurrency || '').toUpperCase();
  if (currency === 'USD') return 1;
  const symbol = USD_CONVERSION_SYMBOLS[currency];
  const price = Number(pricesBySymbol?.get(symbol));
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Cannot convert ${currency} PnL to USD without a live forex price.`);
  }
  return ['JPY', 'CHF', 'CAD'].includes(currency) ? 1 / price : price;
}

function calculateForexPnl(trade, currentPrice, quoteToUsdRate = 1) {
  const entryPrice = Number(trade.entry_price);
  const price = Number(currentPrice);
  const units = Number(trade.units);
  const conversion = Number(quoteToUsdRate);
  if (![entryPrice, price, units, conversion].every(Number.isFinite) ||
      entryPrice <= 0 || price <= 0 || units <= 0 || conversion <= 0 ||
      !['BUY', 'SELL'].includes(trade.side)) {
    throw new Error('Cannot calculate forex PnL from an invalid trade or market price.');
  }
  return (trade.side === 'BUY' ? price - entryPrice : entryPrice - price) * units * conversion;
}

function calculateForexMargin(lotSize, price, leverage, quoteToUsdRate, lotUnits = 100000) {
  const lots = Number(lotSize);
  const entryPrice = Number(price);
  const leverageValue = Number(leverage);
  const conversion = Number(quoteToUsdRate);
  const contractUnits = Number(lotUnits);
  if (![lots, entryPrice, leverageValue, conversion, contractUnits].every(Number.isFinite) ||
      lots <= 0 || entryPrice <= 0 || leverageValue <= 0 || conversion <= 0 || contractUnits <= 0) {
    throw new Error('Forex lot size, price, leverage, or currency conversion is invalid.');
  }
  const units = lots * contractUnits;
  return {
    units,
    notionalUsd: units * entryPrice * conversion,
    marginUsd: units * entryPrice * conversion / leverageValue
  };
}

function parseSwissquotePrice(payload) {
  if (!Array.isArray(payload)) throw new Error('Swissquote returned an invalid quote payload.');
  const quotes = payload.map(server => {
    const profiles = Array.isArray(server.spreadProfilePrices) ? server.spreadProfilePrices : [];
    const profile = profiles.find(item => item.spreadProfile === 'prime') ||
      profiles.find(item => item.spreadProfile === 'standard') ||
      profiles[0];
    const bid = Number(profile?.bid);
    const ask = Number(profile?.ask);
    const publishedAt = Number(server.ts);
    if (![bid, ask, publishedAt].every(Number.isFinite) || bid <= 0 || ask < bid || publishedAt <= 0) return null;
    return { price: (bid + ask) / 2, bid, ask, publishedAt };
  }).filter(Boolean).sort((left, right) => right.publishedAt - left.publishedAt);
  if (!quotes.length) throw new Error('Swissquote returned no valid bid/ask prices.');
  return quotes[0];
}

function resolveForexStopTargetPrices({
  executionPrice,
  units,
  quoteToUsdRate,
  pipSize,
  side,
  mode,
  sl = null,
  tp = null,
  slAmount = null,
  tpAmount = null
}) {
  const entry = Number(executionPrice);
  const positionUnits = Number(units);
  const conversion = Number(quoteToUsdRate);
  const pip = Number(pipSize);
  if (![entry, positionUnits, conversion, pip].every(Number.isFinite) ||
      entry <= 0 || positionUnits <= 0 || conversion <= 0 || pip <= 0 ||
      !['BUY', 'SELL'].includes(side) || !['pips', 'amount'].includes(mode)) {
    throw new Error('Forex entry price, size, side, or stop mode is invalid.');
  }

  const direction = side === 'BUY' ? 1 : -1;
  let stopLoss = null;
  let takeProfit = null;
  if (mode === 'pips') {
    const stopPips = sl == null ? null : Number(sl);
    const targetPips = tp == null ? null : Number(tp);
    if ([stopPips, targetPips].some(value => value != null && (!Number.isFinite(value) || value <= 0))) {
      throw new Error('SL/TP pip distances must be positive.');
    }
    stopLoss = stopPips == null ? null : entry - direction * stopPips * pip;
    takeProfit = targetPips == null ? null : entry + direction * targetPips * pip;
  } else {
    const loss = slAmount == null ? null : Number(slAmount);
    const profit = tpAmount == null ? null : Number(tpAmount);
    if ([loss, profit].some(value => value != null && (!Number.isFinite(value) || value <= 0))) {
      throw new Error('SL/TP dollar amounts must be positive.');
    }
    const usdPerPriceUnit = positionUnits * conversion;
    stopLoss = loss == null ? null : entry - direction * loss / usdPerPriceUnit;
    takeProfit = profit == null ? null : entry + direction * profit / usdPerPriceUnit;
  }

  if ((stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) ||
      (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0))) {
    throw new Error('Stop loss amount is too large for this position.');
  }
  return { sl: stopLoss, tp: takeProfit };
}

module.exports = {
  USD_CONVERSION_SYMBOLS,
  calculateForexMargin,
  calculateForexPnl,
  getQuoteToUsdRate,
  parseSwissquotePrice,
  resolveForexStopTargetPrices
};
