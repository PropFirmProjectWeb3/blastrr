const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const databaseJs = fs.readFileSync('database.js', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');
const homeHtml = fs.readFileSync('public/index.html', 'utf8');

test('BlastrrPass seeds twelve levels and keeps earning XP after level 12', () => {
  assert.match(databaseJs, /level <= 12/);
  assert.match(databaseJs, /level \* 10000/);
  assert.match(serverJs, /Math\.min\(12, Math\.floor\(Math\.max\(0, Number\(xp\) \|\| 0\) \/ 10000\)\)/);
  assert.match(serverJs, /xp = xp \+ \?/);
  assert.match(appHtml, /id="battlepass-level-list"/);
  assert.match(appJs, /max level/);
});

test('battle pass task rewards are period-limited and built-in trading tasks are supported', () => {
  assert.match(databaseJs, /'GREEN_DAY', 'GREEN_WEEK', 'TRADE_DAY', 'WITHDRAWAL'/);
  assert.match(databaseJs, /is_builtin INTEGER NOT NULL DEFAULT 0/);
  assert.match(databaseJs, /UNIQUE\(wallet_address, task_id, cadence, period_key\)/);
  assert.match(serverJs, /task\.task_type === 'TRADE_DAY'/);
  assert.match(databaseJs, /'Paid withdrawal'.*'WITHDRAWAL', 'DAILY'/);
  assert.match(serverJs, /task\.task_type === 'GREEN_DAY' \? 1 : 7/);
  assert.match(serverJs, /date\(COALESCE\(w\.paid_at, w\.created_at\)\)/);
  assert.match(serverJs, /date\(COALESCE\(rw\.paid_at, rw\.created_at\)\)/);
  assert.match(serverJs, /app\.post\('\/api\/battlepass\/tasks\/claim', sensitiveLimiter, requireWalletSession/);
});

test('admin can configure standard discounts, level costs, plan awards, and custom tasks', () => {
  assert.match(appHtml, /id="admin-battlepass-settings-form"/);
  assert.match(appHtml, /id="admin-battlepass-level-rewards"/);
  assert.match(appHtml, /id="admin-battlepass-plan-rewards"/);
  assert.match(appHtml, /id="admin-battlepass-task-form"/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/battlepass\/settings', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/battlepass\/levels\/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/battlepass\/plan-rewards\/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/battlepass\/tasks\/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet/);
  assert.match(serverJs, /WHERE id = \? AND is_builtin = 1/);
});

test('profile rewards and level discounts are wallet-bound and checkout applies the configured discount', () => {
  assert.match(serverJs, /WHERE code = \? AND LOWER\(wallet_address\) = LOWER\(\?\) AND redeemed_at IS NULL/);
  assert.match(serverJs, /app\.post\('\/api\/accounts\/purchase', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /const totalDiscountPct = Math\.min\(100, standardDiscountPct \+ bonusDiscountPct\)/);
  assert.match(serverJs, /xp_awarded: isFreeRedemption \? 0 : xpAward/);
  assert.match(appJs, /standardDiscountPct \+ \(activePromoCode \? battlePassDiscountBonusPct : 0\)/);
  assert.match(appJs, /compactBattlePassXp/);
});

test('leaderboards and public profile cards include BlastrrPass level and XP', () => {
  assert.equal((serverJs.match(/AS battlepass_xp/g) || []).length, 3);
  assert.equal((serverJs.match(/b\.profile_image_url, COALESCE\(b\.xp/g) || []).length, 3);
  assert.match(appJs, /<small>Battle Pass rank<\/small>/);
  assert.match(appJs, /<small>XP earned<\/small>/);
  assert.match(appHtml, /id="profile-battlepass-avatar"/);
  assert.match(appJs, /const battlePassRank = battlePassLevel \? `Level \$\{battlePassLevel\}` : 'Unranked'/);
  assert.match(appJs, /class="battlepass-avatar-wrap leaderboard-avatar"/);
  assert.match(appJs, /row\.profile_image_url, row\.username/);
  assert.match(appJs, /setBattlePassAvatar\(document\.getElementById\('profile-battlepass-avatar'\), battlePassProfile\.profile_image_url, username\)/);
  assert.match(appJs, /loadPublicBattlePassProfile/);
  assert.match(appJs, /platform\.twitter\.com\/widgets\.js/);
  assert.match(homeHtml, /standardDiscountPct=Number\(data\.standard_discount_pct\?\?90\)/);
});

test('BlastrrPass dashboard presents missions, rewards, leaderboard, and profile sections', () => {
  assert.match(appHtml, /class="battlepass-mission-board"/);
  assert.match(appHtml, /data-battlepass-tab="missions"/);
  assert.match(appHtml, /data-battlepass-tab="rewards"/);
  assert.match(appHtml, /data-battlepass-tab="leaderboard"/);
  assert.match(appHtml, /data-battlepass-tab="profile"/);
  assert.match(appHtml, /id="battlepass-claim-all"/);
  assert.match(appHtml, /id="battlepass-level-segments"/);
  assert.match(appJs, /function claimAllBattlePassRewards/);
  assert.match(appJs, /function selectBattlePassTab/);
  assert.match(appJs, /class="battlepass-task battlepass-reward-item"/);
  assert.match(appJs, /class="battlepass-reward-code"/);
  assert.match(appJs, /const defaultImageUrl = '\/favicon\.png'/);
});

test('Blastrr logo is used as the site favicon', () => {
  assert.match(appHtml, /href="\/favicon\.png"/);
  assert.match(homeHtml, /href="\/favicon\.png"/);
  assert.equal(fs.existsSync('public/favicon.png'), true);
});

test('battle pass profile images are verified as loadable direct image URLs before saving', () => {
  assert.match(appHtml, /Google Images search\/result page links are not image URLs/);
  assert.match(appJs, /function validateBattlePassImageUrl\(imageUrl\)/);
  assert.match(appJs, /if \(imageUrl\) await validateBattlePassImageUrl\(imageUrl\)/);
  assert.match(appJs, /Open the image itself and copy its direct image address/);
  assert.doesNotMatch(appJs, /image\.referrerPolicy = 'no-referrer'/);
});

test('homepage plan cards use Battle Pass task and reward styling with all configured account rules', () => {
  assert.match(homeHtml, /class="plan battlepass-plan-card/);
  assert.match(homeHtml, /plan-purchase-reward-label/);
  assert.match(homeHtml, /plan-task-list/);
  assert.match(homeHtml, /STRAIGHT TO FUNDED/);
  assert.match(homeHtml, /Profit consistency<\/span><strong>\$\{p\.max_single_day_profit_pct\}%/);
  assert.match(homeHtml, /\["Profit consistency",p=>`\$\{p\.max_single_day_profit_pct\}% max single-day profit`\]/);
  assert.match(homeHtml, /Trading availability<\/span><strong>24\/7\/365<\/strong>/);
  assert.match(homeHtml, /\["Trading availability",\(\)=>"24\/7\/365"\]/);
});

test('terminal buy-plan cards show funded status, purchase reward styling, and all account rules', () => {
  assert.match(appJs, /class="card purchase-plan-card/);
  assert.match(appJs, /purchase-plan-status/);
  assert.match(appJs, /STRAIGHT TO FUNDED/);
  assert.match(appJs, /purchase-plan-reward/);
  assert.match(appJs, /Profit consistency<\/span><strong>\$\{Number\(plan\.max_single_day_profit_pct\)\}% max single-day profit/);
  assert.match(appJs, /Trading availability<\/span><strong>24\/7\/365/);
});

test('dashboard and admin use black surfaces with subdued neutral nav borders', () => {
  assert.match(appCss, /--surface-glass:\s*rgba\(10,\s*11,\s*12,\s*0\.94\)/);
  assert.match(appCss, /body:not\(\.auth-locked\) \{ background: #050607; \}/);
  assert.match(appCss, /border-color: rgba\(180, 190, 200, 0\.26\);[\s\S]*?box-shadow: 0 0 6px rgba\(180, 190, 200, 0\.09\)/);
  assert.match(appCss, /\.nav-tab:hover, \.nav-tab:focus-visible/);
  assert.match(appCss, /\.nav-tab\.active/);
  assert.match(appCss, /button:not\(\.nav-tab\):not\(\.admin-section-tab\)/);
  assert.match(appCss, /\.admin-section-tab:hover, \.admin-section-tab:focus-visible, \.admin-section-tab\.active/);
});
