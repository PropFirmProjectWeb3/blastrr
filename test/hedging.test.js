const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const databaseJs = fs.readFileSync('database.js', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');

test('hedging alert tables retain the event and the accounts and open trades involved', () => {
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS hedging_alerts/);
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS hedging_alert_accounts/);
  assert.match(databaseJs, /idx_hedging_alerts_wallet_created/);
  assert.match(databaseJs, /idx_hedging_alert_accounts_account/);
});

test('trade execution blocks same-symbol opposite positions across accounts and freezes the involved accounts', () => {
  const executeTrade = serverJs.slice(serverJs.indexOf('function executeTradeForAccount'), serverJs.indexOf("app.post('/api/trades/execute'"));
  const transactionStart = executeTrade.indexOf("db.run('BEGIN IMMEDIATE'");
  const hedgeCheck = executeTrade.indexOf('SELECT t.id AS trade_id, t.account_id, t.side');
  const balanceReservation = executeTrade.indexOf('UPDATE accounts SET current_balance = current_balance - ?');
  assert.ok(transactionStart >= 0 && hedgeCheck > transactionStart && balanceReservation > hedgeCheck);
  assert.match(executeTrade, /LOWER\(a\.wallet_address\) = LOWER\(\?\) AND t\.account_id != \?/);
  assert.match(executeTrade, /t\.symbol = \? AND t\.side = \? AND t\.status = 'OPEN'/);
  assert.match(executeTrade, /side === 'BUY' \? 'SELL' : 'BUY'/);
  assert.match(executeTrade, /UPDATE accounts SET admin_frozen = 1/);
  assert.match(executeTrade, /INSERT INTO hedging_alerts/);
  assert.match(executeTrade, /INSERT INTO hedging_alert_accounts/);
  assert.match(executeTrade, /hedging_violation: true/);
});

test('admins can see active hedging alerts and use existing account freeze controls to review affected users', () => {
  assert.match(serverJs, /app\.post\('\/api\/admin\/hedging-alerts', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /HAVING COUNT\(DISTINCT CASE WHEN a\.admin_frozen = 1 THEN a\.id END\) > 0/);
  assert.match(appHtml, /id="admin-hedging-alert-list"/);
  assert.match(appHtml, /resolve the issue before unfreezing the involved accounts/);
  assert.match(appJs, /loadAdminHedgingAlerts\(\)/);
  assert.match(appJs, /data-hedging-review-wallet/);
  assert.match(appJs, /data-admin-account-action="\$\{adminFreeze \? 'UNFREEZE' : 'FREEZE'\}"/);
  assert.match(appJs, /Admin freeze: \$\{escapeHTML\(account\.admin_freeze_reason \|\| ''\)\}/);
  assert.match(appCss, /\.admin-hedging-alert-list \{ display: grid; gap: 10px; \}/);
});
