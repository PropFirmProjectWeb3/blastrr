const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { getTriggeredExitPrice, resolveStopTargetPrices } = require('../tradeRules');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');

test('dollar SL/TP amounts resolve to execution-price triggers for long positions', () => {
  const levels = resolveStopTargetPrices({
    executionPrice: 100,
    units: 20,
    side: 'BUY',
    mode: 'amount',
    slAmount: 500,
    tpAmount: 1000
  });

  assert.deepEqual(levels, { sl: 75, tp: 150 });
});

test('dollar SL/TP amounts resolve to execution-price triggers for short positions', () => {
  const levels = resolveStopTargetPrices({
    executionPrice: 100,
    units: 20,
    side: 'SELL',
    mode: 'amount',
    slAmount: 500,
    tpAmount: 1000
  });

  assert.deepEqual(levels, { sl: 125, tp: 50 });
});

test('amount-based exits use their trigger price instead of a later overshooting quote', () => {
  assert.equal(getTriggeredExitPrice({ price: 140, side: 'BUY', sl: 75, tp: 150 }), null);
  assert.equal(getTriggeredExitPrice({ price: 190, side: 'BUY', sl: 75, tp: 150 }), 150);
  assert.equal(getTriggeredExitPrice({ price: 60, side: 'BUY', sl: 75, tp: 150 }), 75);
  assert.equal(getTriggeredExitPrice({ price: 60, side: 'SELL', sl: 125, tp: 50 }), null);
  assert.equal(getTriggeredExitPrice({ price: 20, side: 'SELL', sl: 125, tp: 50 }), 50);
  assert.equal(getTriggeredExitPrice({ price: 140, side: 'SELL', sl: 125, tp: 50 }), 125);
  assert.match(serverJs, /SELECT t\.id, t\.symbol, t\.side, t\.sl, t\.tp, t\.sl_tp_mode, a\.wallet_address/);
  assert.match(serverJs, /trade\.sl_tp_mode === 'amount' \? exitPrice : null/);
  assert.match(serverJs, /const overridePrice = Number\(options\.exitPrice\)/);
  assert.match(serverJs, /Number\.isFinite\(overridePrice\) && overridePrice > 0\s+\? Promise\.resolve\(overridePrice\)/);
  assert.match(serverJs, /\}, \{ exitPrice: trade\.exitPrice \}\);/);
});

test('amount mode supports optional individual stop and target values', () => {
  assert.deepEqual(resolveStopTargetPrices({
    executionPrice: 100,
    units: 20,
    side: 'BUY',
    mode: 'amount',
    tpAmount: 1000
  }), { sl: null, tp: 150 });
});

test('price mode preserves explicit trigger prices and validates their direction', () => {
  assert.deepEqual(resolveStopTargetPrices({
    executionPrice: 100,
    units: 20,
    side: 'BUY',
    mode: 'price',
    sl: 90,
    tp: 120
  }), { sl: 90, tp: 120 });
  assert.throws(() => resolveStopTargetPrices({
    executionPrice: 100,
    units: 20,
    side: 'BUY',
    mode: 'price',
    sl: 110
  }), /trigger price is invalid/);
});

test('a dollar stop that implies a non-positive trigger price is rejected', () => {
  assert.throws(() => resolveStopTargetPrices({
    executionPrice: 100,
    units: 10,
    side: 'BUY',
    mode: 'amount',
    slAmount: 1000
  }), /too large for this position/);
});

test('order terminal exposes and submits the dollar amount mode', () => {
  assert.match(appHtml, /id="order-sl-tp-amount-mode"/);
  assert.match(appHtml, /Use dollar P&amp;L for SL\/TP/);
  assert.match(appJs, /sl_tp_mode: amountMode \? 'amount' : 'price'/);
  assert.match(appJs, /sl_amount: amountMode \? sl : null/);
  assert.match(appJs, /tp_amount: amountMode \? tp : null/);
  assert.match(serverJs, /resolveStopTargetPrices\(\{/);
  assert.match(serverJs, /mode: slTpMode/);
});

test('order entry keeps the protection toggle compact and hides liquidation details at spot leverage', () => {
  assert.match(appCss, /\.order-card \.form-group \.order-protection-toggle input \{[^}]*width: 16px[^}]*height: 16px/);
  assert.match(appHtml, /id="order-liquidation-metric" class="order-metric order-metric-risk" hidden/);
  assert.match(appJs, /liquidationMetric\.hidden = Number\(val\) <= 1/);
  assert.match(appJs, /orderMetrics\.classList\.toggle\('is-leveraged', Number\(val\) > 1\)/);
});
