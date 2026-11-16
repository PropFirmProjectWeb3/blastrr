const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const serverJs = fs.readFileSync('server.js', 'utf8');
const databaseJs = fs.readFileSync('database.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');
const chatJs = fs.readFileSync('public/js/chat.js', 'utf8');
const chatCss = fs.readFileSync('public/css/chat.css', 'utf8');

test('leaderboards exclude hidden users and users without a positive active-account balance', () => {
  const leaderboardRoute = serverJs.slice(serverJs.indexOf("app.get('/api/leaderboard'"), serverJs.indexOf("app.get('/api/maintenance/status'"));
  assert.equal((leaderboardRoute.match(/COALESCE\(u\.leaderboard_hidden, 0\) = 0/g) || []).length, 3);
  assert.equal((leaderboardRoute.match(/positive_account\.status = 'ACTIVE' AND COALESCE\(positive_account\.current_balance, 0\) > 0/g) || []).length, 3);
  assert.match(databaseJs, /\['leaderboard_hidden', 'INTEGER NOT NULL DEFAULT 0'\]/);
  assert.match(serverJs, /app\.post\('\/api\/user\/leaderboard-preference', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /UPDATE users SET leaderboard_hidden = \? WHERE LOWER\(wallet_address\) = LOWER\(\?\)/);
  assert.match(appHtml, /id="leaderboard-exclude-self" type="checkbox" disabled/);
  assert.match(appJs, /leaderboard-exclude-self'\)\?\.addEventListener\('change', saveLeaderboardPreference\)/);
  assert.match(appJs, /body: JSON\.stringify\(\{ hidden: checkbox\.checked \}\)/);
  assert.match(appJs, /leaderboardPreference\.checked = Number\(data\.user\.leaderboard_hidden\) === 1/);
});

test('both public chat cards show BlastrrPass rank and title, XP, points, payouts, and referral code', () => {
  assert.equal((serverJs.match(/AS total_payouts/g) || []).length, 2);
  assert.equal((serverJs.match(/AS battlepass_points/g) || []).length, 2);
  assert.equal((serverJs.match(/AS referral_code/g) || []).length, 2);
  assert.equal((serverJs.match(/battlepass_level: getBattlePassLevel\(savedMessage\.battlepass_xp\)/g) || []).length, 1);
  assert.equal((serverJs.match(/battlepass_level: getBattlePassLevel\(message\.battlepass_xp\)/g) || []).length, 1);
  for (const source of [appJs, chatJs]) {
    assert.match(source, /Rank: \$\{Number\(message\.battlepass_level\) \? `Level \$\{Number\(message\.battlepass_level\)\}` : 'Unranked'\}/);
    assert.match(source, /Title: BlastrrPass player/);
    assert.match(source, /message\.battlepass_points/);
    assert.match(source, /message\.total_payouts/);
    assert.match(source, /message\.referral_code/);
  }
  assert.match(appCss, /\.market-chat-player-card \{ width: 290px; \}/);
  assert.match(chatCss, /\.chat-player-card \{[^}]*width: min\(300px, calc\(100vw - 32px\)\)/);
});
