const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const serverJs = fs.readFileSync('server.js', 'utf8');
const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');

test('users can only retrieve their own approved withdrawal certificates', () => {
  const routeStart = serverJs.indexOf("app.get('/api/user/withdrawal-certificates'");
  const routeEnd = serverJs.indexOf("app.post('/api/user/profile'", routeStart);
  const route = serverJs.slice(routeStart, routeEnd);
  assert.match(route, /requireWalletSession/);
  assert.match(route, /FROM withdrawals[\s\S]*?status = 'PAID'/);
  assert.match(route, /COALESCE\(user_amount, ROUND\(amount \* 0\.9, 2\)\)/);
  assert.match(route, /FROM referral_withdrawals[\s\S]*?status = 'PAID'/);
  assert.match(route, /WHERE LOWER\(wallet_address\) = LOWER\(\?\)/);
  assert.match(route, /SELECT username FROM users WHERE LOWER\(wallet_address\) = LOWER\(\?\)/);
  assert.doesNotMatch(route, /'ACCOUNT' AS type|'COMMISSION' AS type|plan_name/);
});

test('profile achievements list approved certificates and download branded JPGs', () => {
  assert.match(appHtml, /src="\/js\/app\.js\?v=20261116-profile-achievements" defer/);
  assert.match(appHtml, /id="profile-achievements-tab"[^>]*>Achievements<\/button>/);
  assert.match(appHtml, /id="profile-achievements-panel"[^>]*role="tabpanel"/);
  assert.match(appHtml, /id="withdrawal-certificates-list"/);
  assert.match(appJs, /\['profile-achievements-panel', 'profile-achievements-tab'\]/);
  assert.match(appJs, /if \(panelId === 'profile-achievements-panel' && connectedWallet\) loadWithdrawalCertificates\(\)/);
  assert.match(appJs, /walletFetch\('\/api\/user\/withdrawal-certificates'\)/);
  assert.match(appJs, /Your certificate will appear here after a withdrawal is marked paid/);
  assert.match(appJs, /data-withdrawal-certificate/);
  assert.match(appJs, /canvas\.toBlob\(resolve, 'image\/jpeg', 0\.94\)/);
  assert.match(appJs, /blastrr-withdrawal-certificate-\$\{button\.dataset\.withdrawalCertificate\}\.jpg/);
  assert.match(appJs, /context\.drawImage\(logo, 105, 104, 78, 78\)/);
  assert.match(appJs, /PERFORMANCE BONUS CERTIFICATE/);
  assert.match(appJs, /received an approved performance bonus of/);
  assert.match(appJs, /<strong>Withdrawal payout<\/strong>/);
  assert.doesNotMatch(appJs, /certificate\.type|data-certificate-type/);
  assert.match(appCss, /\.withdrawal-certificate-card/);
});
