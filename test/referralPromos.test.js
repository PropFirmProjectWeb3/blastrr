const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const databaseJs = fs.readFileSync('database.js', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');

test('creator referral rates default to 2%, are admin-adjustable, and apply to new sales', () => {
  assert.match(databaseJs, /referral_pct REAL NOT NULL DEFAULT 2/);
  assert.match(databaseJs, /commission_pct REAL DEFAULT 2/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/referrals\/search', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/referrals\/commission', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /referralPct < 0 \|\| referralPct > 100/);
  assert.match(serverJs, /const commissionEarned = finalPrice \* referralCommissionPct \/ 100/);
  assert.match(serverJs, /commission_earned, commission_pct/);
  assert.match(appHtml, /id="disp-referral-pct"/);
  assert.match(appHtml, /id="admin-creator-search-form"/);
  assert.match(appJs, /data\.user\.referral_pct/);
  assert.match(appJs, /admin-creators-panel/);
});

test('creator applications are editable, reviewed by admins, and set custom referral bonuses on approval', () => {
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS creator_applications/);
  assert.match(databaseJs, /status TEXT NOT NULL DEFAULT 'PENDING'/);
  assert.match(serverJs, /app\.post\('\/api\/user\/creator-application', sensitiveLimiter, requireTradeSignature/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/creator-applications\/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/creator-applications\/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /allowedCommunitySizes/);
  assert.match(serverJs, /Add at least one social profile link/);
  assert.match(serverJs, /status = 'PENDING'/);
  assert.match(appHtml, /id="creator-application-form"/);
  assert.match(appHtml, /id="creator-application-start"/);
  assert.match(appHtml, /id="admin-creator-applications"/);
  assert.match(appJs, /submitCreatorApplication/);
  assert.match(appJs, /loadAdminCreatorApplications/);
  assert.match(appJs, /reviewCreatorApplication/);
  assert.match(appCss, /creator-application-heading h2/);
});

test('free account codes are plan-bound, admin-generated, and atomically redeemable once', () => {
  assert.match(databaseJs, /CREATE TABLE IF NOT EXISTS promo_codes/);
  assert.match(databaseJs, /claimed_by TEXT/);
  assert.match(databaseJs, /claimed_at DATETIME/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/promo-codes\/create', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/promo-codes\/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/promo\/claim', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /db\.run\('BEGIN IMMEDIATE'/);
  assert.match(serverJs, /WHERE code = \? AND claimed_at IS NULL AND claimed_by IS NULL/);
  assert.match(serverJs, /INSERT INTO accounts \(id, wallet_address, plan_id, initial_balance, current_balance,/);
  assert.match(appHtml, /id="admin-promo-code-form"/);
  assert.match(appHtml, /id="free-account-code"/);
  assert.match(appJs, /walletFetch\('\/api\/promo\/claim'/);
  assert.match(appJs, /addEventListener\('click', claimFreeAccountCode\)/);
  assert.match(appJs, /renderCreatorApplication\(data\.application\)/);
  assert.match(appJs, /async function claimFreeAccountCode/);
});
