const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');
const landingHtml = fs.readFileSync('public/index.html', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');

test('trading terminal HTML loads its external stylesheet and application script', () => {
  assert.match(appHtml, /href="\/css\/app\.css"/);
  assert.match(appHtml, /src="\/js\/app\.js" defer/);
  assert.doesNotMatch(appHtml, /<style[\s>]/i);
  assert.doesNotMatch(appHtml, /<script>\s*[\s\S]*?\bfunction\s/m);
  assert.match(appHtml, /id="nav-menu"/);
  assert.match(appHtml, /id="order-symbol"/);
});

test('trade entry uses metric cards, defaults to spot leverage, and scales the chart for screen size', () => {
  assert.match(appHtml, /id="order-leverage"[^>]*>[\s\S]*?<option value="1" selected>/);
  assert.match(appHtml, /class="order-metrics"/);
  assert.match(appHtml, /<span>Total Position Notional<\/span>/);
  assert.match(appHtml, /<span>Est\. Liquidation Price<\/span>/);
  assert.doesNotMatch(appHtml, /id="tradingview-widget-container"[^>]*style=/);
  assert.match(appCss, /#tradingview-widget-container \{[^}]*height: clamp\(/);
  assert.match(appCss, /main \{[^}]*max-width: 1920px/);
  assert.match(appJs, /liquidation-price-label/);
});

test('mobile navigation has readable, touch-sized links and accessible expanded state', () => {
  assert.match(appHtml, /id="hamburger-icon"[^>]*aria-expanded="false"/);
  assert.match(appJs, /hamburger\.setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(appCss, /header #nav-menu \.nav-tab \{[^}]*min-height: 50px[^}]*font-size: 16px/);
  assert.match(appCss, /header #nav-menu \.nav-tab \{[^}]*min-height: 54px[^}]*font-size: 16px/);
  assert.match(appCss, /max-height: calc\(100vh - 76px\)/);
});

test('NullNet checkout uses the correct chain ID and matching wallet and verification RPC settings', () => {
  assert.match(appJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"[\s\S]*?nativeCurrency: \{ name: "LUN", symbol: "LUN", decimals: 18 \}/);
  assert.match(serverJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"/);
  assert.match(appJs, /method: 'wallet_addEthereumChain'/);
  assert.match(appJs, /const activeChainId = BigInt\(await provider\.request\(\{ method: 'eth_chainId' \}\)\)/);
});

test('live market PnL feeds server-side risk checks and active trade responses', () => {
  assert.match(serverJs, /function loadAccountWithLiveRisk/);
  assert.match(serverJs, /getLiveRiskBalance\(account, openTrades, pricesBySymbol\)/);
  assert.match(serverJs, /setInterval\(checkLiveRiskLimits, 5000\)/);
  assert.match(serverJs, /risk_balance: getRiskBalance\(liveAccount\)/);
  assert.match(serverJs, /Math\.max\(0, getTradeMargin\(trade\) \+ pnl\)/);
  assert.match(appJs, /Number\.isFinite\(Number\(trd\.live_pnl\)\)/);
});

test('live market polling uses browser-side provider URLs, not the app proxy', () => {
  assert.match(appJs, /https:\/\/api\.binance\.com\/api\/v3\/ticker\/price/);
  assert.match(appJs, /https:\/\/fapi\.binance\.com\/fapi\/v1\/ticker\/price/);
  assert.doesNotMatch(appJs, /\/api\/market\/price/);
});

test('landing-page plans are loaded from the shared plans API', () => {
  assert.match(landingHtml, /fetch\("\/api\/plans"\)/);
  assert.doesNotMatch(landingHtml, /\{name:"Micro",capital:/);
  const inlineScript = [...landingHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(script => script.trim());
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new vm.Script(inlineScript));
});

test('landing navigation links to the unified terminal instead of legacy spot and futures pages', () => {
  assert.match(landingHtml, /const APP_URL = "app\.html"/);
  assert.match(landingHtml, /href="app\.html">Trade Terminal/);
  assert.doesNotMatch(landingHtml, /href="(?:spot|perps)\.html"/);
});

test('account cards expose expandable trade history and daily profit charts', () => {
  assert.match(appJs, /<details class="account-expanded"/);
  assert.match(appJs, /renderDailyProfitChart/);
  assert.match(appJs, /Daily profit by date/);
  assert.match(appJs, /walletFetch\(`\/api\/accounts\/details/);
});

test('accounts view hides locked accounts by default and can reveal them with its active-only switch', () => {
  assert.match(appHtml, /id="accounts-active-only" type="checkbox" checked/);
  assert.match(appHtml, /Show active accounts only/);
  assert.match(appJs, /function toggleActiveAccountsOnly\(checked\)/);
  assert.match(appJs, /!acc\.lock_reason/);
  assert.match(appJs, /showActiveAccountsOnly && !isActive/);
});

test('payout UI shows the 90/10 split, admin trade review, and account freeze controls', () => {
  assert.match(appJs, /You receive: \$\$\{data\.user_amount\.toFixed\(2\)\}/);
  assert.match(appJs, /renderAdminTradeTable/);
  assert.match(appJs, /\/api\/admin\/accounts\/action/);
  assert.match(appJs, /withdrawalPending/);
  assert.match(appHtml, /admin-account-list/);
  assert.match(appHtml, /Gross \/ user net \/ admin share/);
});

test('admin UI reports non-JSON API responses with a server deployment hint', () => {
  assert.match(appJs, /readAdminApiResponse/);
  assert.match(appJs, /HTML page instead of API JSON/);
  assert.match(appJs, /Restart\/deploy the latest server code/);
});

test('trade actions reuse the signed wallet session and do not show modal success notifications', () => {
  assert.match(appJs, /walletFetch\('\/api\/trades\/execute'/);
  assert.match(appJs, /walletFetch\('\/api\/trades\/close'/);
  assert.doesNotMatch(appJs, /alert\(`Order executed at/);
  assert.doesNotMatch(appJs, /alert\(`Position closed/);
  assert.ok(serverJs.includes("app.post('/api/trades/execute', sensitiveLimiter, requireWalletSession"));
  assert.ok(serverJs.includes("app.post('/api/trades/close', sensitiveLimiter, requireWalletSession"));
});

test('browser application files contain no copied provider credentials', () => {
  assert.doesNotMatch(`${appHtml}\n${appJs}`, /alch_[A-Za-z0-9_-]+/);
});
