const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveStopTargetPrices } = require('../tradeRules');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');

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
  assert.match(appHtml, /Enter SL\/TP as dollar P&amp;L amounts/);
  assert.match(appJs, /sl_tp_mode: amountMode \? 'amount' : 'price'/);
  assert.match(appJs, /sl_amount: amountMode \? sl : null/);
  assert.match(appJs, /tp_amount: amountMode \? tp : null/);
  assert.match(serverJs, /resolveStopTargetPrices\(\{/);
  assert.match(serverJs, /mode: slTpMode/);
});
