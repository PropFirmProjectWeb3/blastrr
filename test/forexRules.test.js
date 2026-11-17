const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateForexMargin,
  calculateForexPnl,
  floorToNewYorkInterval,
  getQuoteToUsdRate,
  parseForexChartHistory,
  parseSwissquotePrice,
  resolveForexStopTargetPrices
} = require('../forexRules');

const prices = new Map([
  ['FX:EURUSD', 1.1],
  ['FX:USDJPY', 150],
  ['FX:USDCHF', 0.9],
  ['FX:USDCAD', 1.35],
  ['FX:GBPUSD', 1.25]
]);

test('forex conversions use USD quotes and invert non-USD quote pairs', () => {
  assert.equal(getQuoteToUsdRate('USD', prices), 1);
  assert.equal(getQuoteToUsdRate('JPY', prices), 1 / 150);
  assert.equal(getQuoteToUsdRate('GBP', prices), 1.25);
});

test('Swissquote quotes use the newest prime bid/ask midpoint', () => {
  assert.deepEqual(parseSwissquotePrice([
    { ts: 1000, spreadProfilePrices: [{ spreadProfile: 'prime', bid: 1.1, ask: 1.2 }] },
    { ts: 2000, spreadProfilePrices: [{ spreadProfile: 'prime', bid: 1.2, ask: 1.3 }] }
  ]), { price: 1.25, bid: 1.2, ask: 1.3, publishedAt: 2000 });
});

test('Forex chart candles use New York time across daylight-saving changes', () => {
  const fallFirstHour = Date.UTC(2026, 10, 1, 5, 30) / 1000;
  const fallSecondHour = Date.UTC(2026, 10, 1, 6, 30) / 1000;
  assert.equal(floorToNewYorkInterval(fallFirstHour, 60 * 60), Date.UTC(2026, 10, 1, 5) / 1000);
  assert.equal(floorToNewYorkInterval(fallSecondHour, 60 * 60), Date.UTC(2026, 10, 1, 6) / 1000);

  const firstTick = Date.UTC(2026, 2, 8, 7, 30) / 1000;
  const secondTick = Date.UTC(2026, 2, 8, 8, 30) / 1000;
  const history = parseForexChartHistory({
    chart: {
      result: [{
        meta: { chartPreviousClose: 1.05 },
        timestamp: [firstTick, secondTick],
        indicators: {
          quote: [{
            open: [1.1, 1.15],
            high: [1.12, 1.2],
            low: [1.09, 1.14],
            close: [1.15, 1.18]
          }]
        }
      }]
    }
  }, 4 * 60 * 60, secondTick + 60);
  assert.deepEqual(history.candles.map(candle => candle.time), [
    Date.UTC(2026, 2, 8, 5) / 1000,
    Date.UTC(2026, 2, 8, 8) / 1000
  ]);
  assert.equal(history.stats.referencePrice, 1.05);
  assert.equal(history.stats.highPrice, 1.2);
  assert.equal(history.stats.lowPrice, 1.09);
});

test('forex margin is standard-lot notional converted to USD and divided by leverage', () => {
  assert.deepEqual(calculateForexMargin(1, 150, 50, 1 / 150), {
    units: 100000,
    notionalUsd: 100000,
    marginUsd: 2000
  });
});

test('forex PnL converts pip movement into account USD', () => {
  const pnl = calculateForexPnl({
    side: 'BUY', entry_price: 150, units: 100000
  }, 150.01, 1 / 150);
  assert.ok(Math.abs(pnl - 100000 * 0.01 / 150) < 1e-10);
});

test('forex stops support pip distances and dollar risk amounts', () => {
  assert.deepEqual(resolveForexStopTargetPrices({
    executionPrice: 1.1,
    units: 100000,
    quoteToUsdRate: 1,
    pipSize: 0.0001,
    side: 'BUY',
    mode: 'pips',
    sl: 20,
    tp: 35
  }), { sl: 1.098, tp: 1.1035 });
  assert.deepEqual(resolveForexStopTargetPrices({
    executionPrice: 1.1,
    units: 100000,
    quoteToUsdRate: 1,
    pipSize: 0.0001,
    side: 'BUY',
    mode: 'amount',
    slAmount: 100,
    tpAmount: 200
  }), { sl: 1.099, tp: 1.102 });
});
