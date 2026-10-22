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
  assert.doesNotMatch(appHtml, /\p{Extended_Pictographic}/u);
  assert.match(appHtml, /class="hamburger-glyph"/);
});

test('trading terminal displays a responsive 24/7 crypto market status card', () => {
  assert.match(appHtml, /<div class="chart-heading-group">[\s\S]*?id="chart-title"[\s\S]*?class="market-hours-status" aria-label="Crypto markets trade 24\/7\/365"/);
  assert.match(appHtml, /24\/7 TRADING LIVE/);
  assert.match(appCss, /\.chart-heading-group\s*\{[^}]*display:\s*flex/);
  assert.match(appCss, /\.market-hours-status\s*\{[^}]*border-radius:\s*999px/);
  assert.doesNotMatch(appHtml, /<aside class="market-hours-status"/);
});

test('trading terminal uses the homepage Blastrr wordmark and lightning mark styling', () => {
  assert.match(appHtml, /<a class="logo" href="index\.html" aria-label="Blastrr home">[\s\S]*?<span class="brand-mark" aria-hidden="true">ϟ<\/span>[\s\S]*?<span>BLASTRR<\/span>/);
  assert.match(landingHtml, /<a class="brand" href="index\.html" aria-label="Blastrr home"><span class="brand-mark">ϟ<\/span><span>BLASTRR<\/span><\/a>/);
  assert.match(appCss, /\.logo\s*\{[^}]*font-size:\s*20px;[^}]*font-weight:\s*950;[^}]*letter-spacing:\s*0\.08em/);
  assert.match(appCss, /\.logo \.brand-mark\s*\{[^}]*background:\s*linear-gradient\(145deg,\s*#bd91ff,\s*#6424e8\)[^}]*clip-path:\s*polygon\(40% 0,\s*100% 0,\s*64% 43%,\s*91% 43%,\s*23% 100%,\s*40% 55%,\s*12% 55%\)/);
  assert.match(landingHtml, /\.brand-mark\{[^}]*background:linear-gradient\(145deg,#bd91ff,#6424e8\)[^}]*clip-path:polygon\(40% 0,100% 0,64% 43%,91% 43%,23% 100%,40% 55%,12% 55%\)/);
});

test('homepage focuses on crypto markets without promoting derivatives products', () => {
  assert.match(landingHtml, /20 major Binance crypto markets/);
  assert.match(landingHtml, /Crypto trading terminal/);
  assert.doesNotMatch(landingHtml, /perpetual|perps|CME|index contract/i);
  assert.match(landingHtml, /without the scheduled daily sessions and weekly closes typical of many FX and futures markets/);
});

test('terminal surfaces use the glass and slate theme', () => {
  assert.match(appCss, /--surface-glass: rgba\(20, 27, 38, 0\.72\)/);
  assert.match(appCss, /backdrop-filter: blur\(20px\) saturate\(130%\)/);
  assert.match(appCss, /background: rgba\(30, 41, 59, 0\.46\)/);
  assert.match(appCss, /header #nav-menu \{[\s\S]*?backdrop-filter: blur\(24px\) saturate\(145%\)/);
  assert.match(appCss, /\.hamburger-btn\.menu-open \.hamburger-glyph::before \{ transform: rotate\(45deg\); \}/);
  assert.match(appCss, /\.hamburger-btn\.menu-open \.hamburger-glyph::after \{ transform: rotate\(-45deg\); \}/);
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

test('TradingView chart uses homepage candle colors with a purple EMA overlay and matching order buttons', () => {
  assert.match(appJs, /"studies":\s*\["MAExp@tv-basicstudies"\]/);
  assert.match(appJs, /"moving average exponential\.plot\.color":\s*"#b68aff"/);
  assert.match(appJs, /"mainSeriesProperties\.candleStyle\.upColor":\s*"#72f0c3"/);
  assert.match(appJs, /"mainSeriesProperties\.candleStyle\.downColor":\s*"#ff638e"/);
  assert.match(appCss, /\.order-actions \.btn-buy\s*\{[^}]*#72f0c3/);
  assert.match(appCss, /\.order-actions \.btn-sell\s*\{[^}]*#ff638e/);
});

test('open positions show margin and notional separately and refresh PnL with live quotes', () => {
  assert.match(appHtml, /<th>Margin \/ Notional \(\$\)<\/th>/);
  assert.match(appJs, /const notional = Number\(trd\.units\) \* Number\(trd\.entry_price\)/);
  assert.match(appJs, /function updateDisplayedOpenTradePnls\(currentPrice\)/);
  assert.match(appJs, /updateDisplayedOpenTradePnls\(currentLivePrice\)/);
  assert.match(appJs, /setInterval\(\(\) => fetchPrice\(pair, type, source, generation\), 1000\)/);
});

test('mobile navigation has readable, touch-sized links and accessible expanded state', () => {
  assert.match(appHtml, /id="hamburger-icon"[^>]*aria-expanded="false"/);
  assert.match(appJs, /hamburger\.setAttribute\('aria-expanded', String\(isOpen\)\)/);
  assert.match(appCss, /header #nav-menu \.nav-tab \{[^}]*min-height: 50px[^}]*font-size: 16px/);
  assert.match(appCss, /header #nav-menu \.nav-tab \{[^}]*min-height: 54px[^}]*font-size: 16px/);
  assert.match(appCss, /max-height: calc\(100vh - 76px\)/);
  assert.match(appCss, /@media \(max-width: 700px\) \{[\s\S]*?header \{ flex-wrap: wrap; row-gap: 10px; gap: 10px; padding: 12px; \}[\s\S]*?\.header-actions \{ order: 2; flex: 1 0 100%;[\s\S]*?\.hamburger-btn \{ position: absolute; top: 12px; right: 12px;[\s\S]*?background: rgba\(11, 16, 24, 0\.98\)/);
  assert.match(appCss, /header #nav-menu \.nav-tab:not\(\.active\) \{ color: #e2e8f0; background: rgba\(30, 41, 59, 0\.82\); \}/);
});

test('NullNet checkout uses the correct chain ID and matching wallet and verification RPC settings', () => {
  assert.match(appJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"[\s\S]*?nativeCurrency: \{ name: "LUN", symbol: "LUN", decimals: 18 \}[\s\S]*?usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b",[\s\S]*?decimals: 18/);
  assert.match(serverJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"[\s\S]*?decimals: 18/);
  assert.match(appJs, /const rawAmount = toTokenUnits\(priceUsdt, chainConfig\.decimals\)/);
  assert.match(serverJs, /rawValue >= expectedRawValue/);
  assert.match(appJs, /method: 'wallet_addEthereumChain'/);
  assert.match(appJs, /const activeChainId = BigInt\(await provider\.request\(\{ method: 'eth_chainId' \}\)\)/);
});

test('purchase calldata encodes USDT amounts using each token decimal precision', () => {
  const helper = appJs.match(/function toTokenUnits\(amount, decimals\) \{[\s\S]*?\n        \}/);
  assert.ok(helper);
  const toUnits = new vm.Script(`${helper[0]}\ntoTokenUnits`).runInNewContext();
  assert.equal(toUnits('12.34', 18).toString(), '12340000000000000000');
  assert.equal(toUnits('12.34', 6).toString(), '12340000');
});

test('startup correction only adjusts untouched accounts with the old Whale capital', () => {
  assert.match(serverJs, /initial_balance = 250050 AND current_balance = 250050/);
  assert.match(serverJs, /current_equity = 250050 AND high_water_mark = 250050/);
  assert.match(serverJs, /NOT EXISTS \(SELECT 1 FROM trades WHERE trades\.account_id = accounts\.id\)/);
  assert.match(serverJs, /NOT EXISTS \(SELECT 1 FROM withdrawals WHERE withdrawals\.account_id = accounts\.id\)/);
});

test('live market PnL feeds server-side risk checks and active trade responses', () => {
  assert.match(serverJs, /function loadAccountWithLiveRisk/);
  assert.match(serverJs, /getLiveRiskBalance\(account, openTrades, pricesBySymbol\)/);
  assert.match(serverJs, /setInterval\(checkLiveRiskLimits, 5000\)/);
  assert.match(serverJs, /risk_balance: getRiskBalance\(liveAccount\)/);
  assert.match(serverJs, /getTradeMargin\(trade\) \+ pnl/);
  assert.match(serverJs, /settleBreachWithinTransaction\(account, breach/);
  assert.match(serverJs, /function unlockExpiredDllAccounts/);
  assert.match(serverJs, /a\.lock_reason IN \('DLL', 'MLL'\)/);
  assert.match(serverJs, /COALESCE\(permanent_lock, 0\) = 1 AND \? = 0/);
  assert.match(appJs, /acc\.lock_reason === 'MLL' \|\| Number\(acc\.permanent_lock\) === 1/);
  assert.match(appJs, /Number\.isFinite\(Number\(trd\.live_pnl\)\)/);
});

test('chart account selector excludes risk-locked accounts and clears when none are selectable', () => {
  assert.match(appJs, /function isRiskLockedAccount\(account\)/);
  assert.match(appJs, /const selectableAccounts = userAccounts\.filter\(isSelectableTradingAccount\)/);
  assert.match(appJs, /No Unlocked Accounts Available/);
  assert.match(appJs, /function isSelectableTradingAccount\(account\)/);
  assert.match(appJs, /isRiskLockedAccount\(account\)/);
});

test('Binance spot and Bitget perp markets use direct browser prices and trusted server pricing', () => {
  assert.match(appJs, /setInterval\(\(\) => fetchPrice\(pair, type, source, generation\), 1000\)/);
  assert.match(appJs, /https:\/\/api\.binance\.com\/api\/v3\/ticker\/price\?symbol=/);
  assert.match(appJs, /https:\/\/api\.bitget\.com\/api\/v2\/mix\/market\/ticker\?productType=USDT-FUTURES&symbol=/);
  assert.match(appJs, /https:\/\/api\.bitget\.com\/api\/v2\/mix\/market\/candles\?productType=USDT-FUTURES/);
  assert.match(appJs, /data\?\.code !== '00000'/);
  assert.match(appJs, /ticker\?\.symbol !== pair/);
  assert.match(appJs, /price = Number\(ticker\.markPrice\)/);
  assert.match(appJs, /function updateLiveMarketChart\(ticker\)/);
  assert.match(appJs, /liveMarketCandleSeries\.update/);
  assert.match(appJs, /initLiveMarketChart\(opt\.dataset\.pair\)/);
  assert.match(appJs, /Charts by TradingView/);
  assert.match(appHtml, /lightweight-charts@4\.2\.3\/dist\/lightweight-charts\.standalone\.production\.js/);
  assert.doesNotMatch(appJs, /\/api\/market\/price/);
  assert.doesNotMatch(appJs, /fapi\.binance\.com|api\.bybit\.com|api\.nasdaq\.com/);
  assert.match(serverJs, /api\.binance\.com\/api\/v3\/ticker\/price\?symbol=/);
  assert.match(serverJs, /api\.bitget\.com\/api\/v2\/mix\/market\/ticker\?productType=USDT-FUTURES&symbol=/);
  assert.match(serverJs, /parsed\.code !== '00000'/);
  assert.match(serverJs, /ticker\?\.symbol !== market\.pair/);
  assert.match(serverJs, /priceValue = ticker\.markPrice/);
  assert.match(serverJs, /market\.source === 'BITGET_PERP' \? marketPrice \* 0\.0005 : 5/);
  assert.match(serverJs, /const legacyTradeMarkets = new Map/);
  assert.match(serverJs, /function getTradeMarket\(symbol\)/);
});

test('landing-page plans are loaded from the shared plans API', () => {
  assert.match(landingHtml, /fetch\("\/api\/plans"\)/);
  assert.doesNotMatch(landingHtml, /\{name:"Micro",capital:/);
  assert.match(landingHtml, /function renderPlans\(\)\{[\s\S]*?host\.querySelectorAll\("\.reveal"\)\.forEach\(element=>observer\.observe\(element\)\)/);
  assert.match(landingHtml, /if\(!plans\.length\)\{[\s\S]*?host\.textContent="Plans are temporarily unavailable/);
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
  assert.match(appJs, /id="profit-target-\$\{acc\.id\}"/);
  assert.match(appJs, /Target: \$\$\{acc\.profit_target\.toLocaleString\(\)\}/);
  assert.match(appCss, /\.account-risk-item \{ display: grid; grid-template-rows: 18px 7px 14px;/);
});

test('accounts view keeps temporary DLL locks visible and can hide permanent MLL locks', () => {
  assert.match(appHtml, /id="accounts-hide-permanent" type="checkbox" checked/);
  assert.match(appHtml, /Hide permanently locked accounts/);
  assert.match(appJs, /function togglePermanentlyLockedAccounts\(checked\)/);
  assert.match(appJs, /acc\.lock_reason === 'MLL'/);
  assert.match(appJs, /hidePermanentlyLockedAccounts && isPermanentlyLocked/);
  assert.doesNotMatch(appJs, /isActive = acc\.status === 'ACTIVE'[\s\S]*?hidePermanentlyLockedAccounts/);
  assert.match(appJs, /No accounts to show\. Turn off “Hide permanently locked accounts”/);
  assert.match(appJs, /account\?\.lock_reason === 'DLL'/);
  assert.match(appJs, /account\?\.lock_reason === 'MLL'/);
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
