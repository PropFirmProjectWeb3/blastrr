const test = require('node:test');
const assert = require('node:assert/strict');
const forexMarkets = require('../public/config/forexMarkets.json');
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

test('XAU/USD is configured as a Swissquote Forex market with standard gold lots', () => {
  const gold = forexMarkets.find(market => market.symbol === 'FX:XAUUSD');
  assert.deepEqual({
    pair: gold?.pair,
    source: gold?.source,
    historySymbol: gold?.history_symbol,
    pipSize: gold?.pip_size,
    lotUnits: gold?.lot_units
  }, {
    pair: 'XAU/USD',
    source: 'SWISSQUOTE',
    historySymbol: 'GC=F',
    pipSize: 0.01,
    lotUnits: 100
  });
  assert.deepEqual(calculateForexMargin(0.01, 2000, 50, 1, gold.lot_units), {
    units: 1,
    notionalUsd: 2000,
    marginUsd: 40
  });
});

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

test('flat Forex price samples are rendered as candles using the prior close', () => {
  const firstTime = Date.UTC(2026, 2, 8, 12, 0) / 1000;
  const secondTime = firstTime + 60;
  const history = parseForexChartHistory({
    chart: {
      result: [{
        timestamp: [firstTime, secondTime],
        indicators: {
          quote: [{
            open: [1.1, 1.101],
            high: [1.1, 1.101],
            low: [1.1, 1.101],
            close: [1.1, 1.101]
          }]
        }
      }]
    }
  }, 60, secondTime + 60);
  assert.deepEqual(history.candles.map(({ open, high, low, close }) => ({ open, high, low, close })), [
    { open: 1.1, high: 1.1, low: 1.1, close: 1.1 },
    { open: 1.1, high: 1.101, low: 1.1, close: 1.101 }
  ]);
  assert.equal(history.stats.highPrice, 1.101);
  assert.equal(history.stats.lowPrice, 1.1);
  assert.equal(history.stats.quoteUpdates24h, undefined);
});

test('forex margin is standard-lot notional converted to USD and divided by leverage', () => {
  assert.deepEqual(calculateForexMargin(1, 150, 50, 1 / 150), {
    units: 100000,
    notionalUsd: 100000,
    marginUsd: 2000
  });
});

test('leveraged forex sizing increases exposure while reserving only required margin', () => {
  const baseLots = 0.1;
  const leverage = 20;
  assert.deepEqual(calculateForexMargin(baseLots * leverage, 1.1, leverage, 1), {
    units: 200000,
    notionalUsd: 220000,
    marginUsd: 11000
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

test('XAUUSD dollar exits target the requested PnL independently of 50x leverage', () => {
  const position = calculateForexMargin(0.5, 4000, 50, 1, 100);
  const levels = resolveForexStopTargetPrices({
    executionPrice: 4000,
    units: position.units,
    quoteToUsdRate: 1,
    pipSize: 0.01,
    side: 'BUY',
    mode: 'amount',
    slAmount: 1000,
    tpAmount: 1000
  });

  assert.equal(position.marginUsd, 4000);
  assert.deepEqual(levels, { sl: 3980, tp: 4020 });
  assert.equal(calculateForexPnl({
    side: 'BUY',
    entry_price: 4000,
    units: position.units
  }, levels.tp), 1000);
  assert.equal(calculateForexPnl({
    side: 'BUY',
    entry_price: 4000,
    units: position.units
  }, levels.sl), -1000);
});
