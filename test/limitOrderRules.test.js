const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isLimitOrderTriggered } = require('../limitOrderRules');

const serverJs = fs.readFileSync('server.js', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');

test('buy limits trigger at or below their limit price only', () => {
  assert.equal(isLimitOrderTriggered('BUY', 100, 100), true);
  assert.equal(isLimitOrderTriggered('BUY', 100, 99), true);
  assert.equal(isLimitOrderTriggered('BUY', 100, 101), false);
});

test('sell limits trigger at or above their limit price only', () => {
  assert.equal(isLimitOrderTriggered('SELL', 100, 100), true);
  assert.equal(isLimitOrderTriggered('SELL', 100, 101), true);
  assert.equal(isLimitOrderTriggered('SELL', 100, 99), false);
});

test('invalid limit order values cannot trigger', () => {
  assert.equal(isLimitOrderTriggered('HOLD', 100, 100), false);
  assert.equal(isLimitOrderTriggered('BUY', 0, 100), false);
  assert.equal(isLimitOrderTriggered('SELL', 100, Number.NaN), false);
});

test('triggered limits are activated by the server and pending orders are excluded from client stops', () => {
  assert.match(serverJs, /function checkPendingLimitOrders\(\)/);
  assert.match(serverJs, /setInterval\(checkPendingLimitOrders, 1000\)/);
  assert.match(serverJs, /UPDATE trades SET status = 'OPEN', entry_price = \?, size_usd = \?, units = \?[\s\S]*?status = 'PENDING'/);
  const stopMonitor = appJs.slice(appJs.indexOf('async function monitorClientStops'), appJs.indexOf('async function signedTradeAuthorization'));
  assert.match(stopMonitor, /trade\.status !== 'OPEN'/);
  const closeTrade = serverJs.slice(serverJs.indexOf('function closeTradeForWallet'), serverJs.indexOf("app.post('/api/trades/close'"));
  assert.match(closeTrade, /WHERE id = \? AND status = \?/);
});
