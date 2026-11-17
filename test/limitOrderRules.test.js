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

test('triggered limits and protective stops are monitored by the server', () => {
  assert.match(serverJs, /function checkPendingLimitOrders\(\)/);
  assert.match(serverJs, /setInterval\(checkPendingLimitOrders, 1000\)/);
  assert.match(serverJs, /UPDATE trades SET status = 'OPEN', entry_price = \?, size_usd = \?, units = \?[\s\S]*?status = 'PENDING'/);
  assert.match(serverJs, /function checkServerStopOrders\(\)/);
  assert.match(serverJs, /setInterval\(checkServerStopOrders, 1000\)/);
  assert.match(serverJs, /closeTradeForWallet\(trade\.id, trade\.wallet_address\.toLowerCase\(\)/);
  const stopMonitor = appJs.slice(appJs.indexOf('async function monitorClientStops'), appJs.indexOf('async function signedTradeAuthorization'));
  assert.doesNotMatch(stopMonitor, /closeTrade\(/);
  assert.doesNotMatch(stopMonitor, /hitStop/);
  assert.match(appJs, /Limit price \(Buy fills at\/below; Sell fills at\/above\)/);
  assert.match(appJs, /if \(isLimit\) \{[\s\S]*?userHasEditedPrice = true/);
  assert.match(appJs, /if \(orderTypeInput\?\.value === 'MARKET'\)/);
  assert.match(appJs, /tradeExecutionInProgress = true/);
  assert.match(appJs, /if \(tradeExecutionInProgress\) return/);
  assert.match(appJs, /displayedOpenTrades\.some\(previous => previous\.id === trade\.id && previous\.status === 'PENDING'\)/);
  assert.match(appJs, /trd\.order_type === 'LIMIT' \? 'Filled limit order'/);
  assert.match(appJs, /const pnl = trd\.status === 'PENDING'\s+\? 0/);
  assert.match(appJs, /if \(trade\.status !== 'OPEN' \|\| trade\.symbol !== selectedSymbol\) continue/);
  assert.match(appJs, /if \(data\.lock\)[\s\S]*?risk limit reached; remaining open and pending orders were closed\./);
  const chartOverlays = appJs.slice(appJs.indexOf('function renderChartTradeOverlays'), appJs.indexOf('function onSymbolChanged'));
  assert.doesNotMatch(chartOverlays, /String\(trade\.id\)\.slice/);
  const executeRoute = serverJs.slice(serverJs.indexOf("app.post('/api/trades/execute'"), serverJs.indexOf('function closeTradeForWallet'));
  assert.match(executeRoute, /const accountTradeRequestKey = `\$\{req\.walletAddress\.toLowerCase\(\)\}:\$\{accountId\}`/);
  assert.match(executeRoute, /const orderType = String\(req\.body\?\.order_type \|\| ''\)\.toUpperCase\(\)/);
  assert.match(executeRoute, /inFlightAccountTradeRequests\.has\(accountTradeRequestKey\)/);
  assert.match(executeRoute, /res\.once\('finish', releaseAccountTradeRequest\)/);
  assert.match(executeRoute, /res\.once\('close', releaseAccountTradeRequest\)/);
  const tradeExecutor = serverJs.slice(serverJs.indexOf('function executeTradeForAccount'), serverJs.indexOf("app.post('/api/trades/execute'"));
  assert.match(tradeExecutor, /const requestedMargin = Number\(margin_used\)/);
  assert.match(tradeExecutor, /UPDATE accounts SET current_balance = current_balance - \?[\s\S]*?\[margin, accountId, margin, accountId\]/);
  const closeTrade = serverJs.slice(serverJs.indexOf('function closeTradeForWallet'), serverJs.indexOf("app.post('/api/trades/close'"));
  assert.match(closeTrade, /WHERE id = \? AND status = \?/);
  assert.match(closeTrade, /riskBreachSettled[\s\S]*?risk_breach_settled/);
});
