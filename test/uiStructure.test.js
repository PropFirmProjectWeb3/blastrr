const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const appCss = fs.readFileSync('public/css/app.css', 'utf8');
const landingHtml = fs.readFileSync('public/index.html', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const faqHtml = fs.readFileSync('public/faq.html', 'utf8');
const faqJs = fs.readFileSync('public/js/faq.js', 'utf8');
const faqCss = fs.readFileSync('public/css/faq.css', 'utf8');
const faqSections = JSON.parse(fs.readFileSync('public/faq-data.json', 'utf8'));
const docsHtml = fs.readFileSync('public/docs.html', 'utf8');
const docsJs = fs.readFileSync('public/js/docs.js', 'utf8');
const docsCss = fs.readFileSync('public/css/docs.css', 'utf8');
const docsSections = JSON.parse(fs.readFileSync('public/docs-data.json', 'utf8'));

test('searchable public FAQ is linked from the homepage and terminal navigation', () => {
  assert.match(landingHtml, /<a href="faq\.html">FAQ<\/a>/);
  assert.match(appHtml, /<a class="nav-tab" href="faq\.html">FAQ<\/a>/);
  assert.match(faqHtml, /<title>FAQ &amp; Knowledge Base \| Blastrr<\/title>/);
  assert.match(faqHtml, /<a href="\/docs\.html">Docs<\/a>/);
  assert.match(faqHtml, /<input id="faq-search" type="search"/);
  assert.match(faqHtml, /id="faq-results" class="faq-results" role="status"/);
  assert.match(faqHtml, /id="faq-content" class="faq-content"/);
  assert.match(faqJs, /normalize\(`\$\{section\.title\} \$\{item\.question\} \$\{item\.answer\}`\)/);
  assert.match(faqJs, /terms\.every\(term => searchableText\.includes\(term\)\)/);
  assert.match(faqJs, /function formatAnswer\(value\)/);
  assert.match(faqJs, /content\.replaceChildren\(\)/);
  assert.match(faqCss, /\.faq-search-row input:focus/);
  assert.equal(faqSections.length, 9);
  assert.equal(faqSections.reduce((count, section) => count + section.items.length, 0), 66);
  const faqQuestions = faqSections.flatMap(section => section.items.map(item => item.question));
  assert.ok(faqQuestions.includes('My access fee payment shows as complete but I have not received my account. When will it be activated?'));
  assert.ok(faqQuestions.includes('My simulated balance has not updated. What troubleshooting steps should I take?'));
  assert.ok(faqQuestions.includes('My claim request shows as processing. How long does verification take?'));
});

test('documentation hub is searchable, structured, and linked from the main entry points', () => {
  assert.match(landingHtml, /<a href="docs\.html">Docs<\/a>/);
  assert.match(appHtml, /<a class="nav-tab" href="docs\.html">Docs<\/a>/);
  assert.match(docsHtml, /<title>Documentation \| Blastrr<\/title>/);
  assert.match(docsHtml, /id="docs-search" type="search"/);
  assert.match(docsHtml, /id="docs-nav" class="docs-nav"/);
  assert.match(docsJs, /normalize\(`\$\{page\.title\} \$\{page\.summary \|\| ''\} \$\{getGroupText\(group\)\}`\)/);
  assert.match(docsJs, /terms\.every\(term => searchableText\.includes\(term\)\)/);
  assert.match(docsJs, /textContent = value/);
  assert.match(docsJs, /function renderTable\(table\)/);
  assert.match(docsJs, /window\.addEventListener\('hashchange'/);
  assert.match(docsCss, /\.docs-layout \{ display: grid; grid-template-columns:/);
  assert.equal(docsSections.length, 13);
  assert.equal(docsSections.reduce((count, page) => count + page.groups.length, 0), 65);
  assert.ok(docsSections.some(page => page.title === 'Trading Markets'));
  assert.ok(docsSections.some(page => page.title === 'Funding Rates'));
  assert.ok(docsSections.some(page => page.title === 'Temporary Leverage Limits'));
  const accountTiers = docsSections.find(page => page.id === 'account-tiers').groups.find(group => group.title === 'Straight-to-Funded Plans');
  assert.ok(accountTiers);
  assert.deepEqual(accountTiers.table.headers, [
    'Tier', 'Simulated Capital', 'Account Type', 'Profit Target',
    'Daily Loss Limit (5%)', 'Max Drawdown (10%)', 'Consistency Rule', 'Execution Schedule'
  ]);
  assert.deepEqual(accountTiers.table.rows.map(row => row[0]), [
    'Micro $5k', 'Starter $10k', 'Trader $20k', 'Pro $50k (Popular)', 'Elite $100k', 'Whale $250k'
  ]);
  assert.deepEqual(accountTiers.table.rows.map(row => row[1]), [
    '$5,000', '$10,000', '$20,000', '$50,000', '$100,000', '$250,000'
  ]);
  assert.ok(accountTiers.table.rows.every(row => row[2] === 'Straight to Funded' && row[7] === '24/7/365'));
  assert.deepEqual(accountTiers.table.rows.map(row => row[3]), ['$1,000', '$2,000', '$4,000', '$10,000', '$20,000', '$50,000']);
  assert.doesNotMatch(JSON.stringify(accountTiers.table), /USDT|off|Purchase Price|Fee|Price/i);
  const riskTable = docsSections.find(page => page.id === 'loss-limits').groups.find(group => group.title === 'Standard Risk Parameters').table;
  assert.equal(riskTable.rows.length, 6);
});

test('trading terminal HTML loads its external stylesheet and application script', () => {
  assert.match(appHtml, /href="\/css\/app\.css"/);
  assert.match(appHtml, /src="\/js\/app\.js" defer/);
  assert.doesNotMatch(appHtml, /<style[\s>]/i);
  assert.doesNotMatch(appHtml, /<script>\s*[\s\S]*?\bfunction\s/m);
  assert.match(appHtml, /id="nav-menu"/);
  assert.match(appHtml, /id="wallet-menu-trigger"[^>]*aria-haspopup="true"/);
  assert.match(appHtml, /id="wallet-menu-accounts"/);
  assert.match(appHtml, /onclick="closeWalletMenu\(\); connectNewWallet\(\)">＋ Add account/);
  assert.match(appHtml, /onclick="closeWalletMenu\(\); disconnectWallet\(\)">Log out/);
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

test('trading terminal and homepage use the Blastrr logo image', () => {
  assert.match(appHtml, /<a class="logo" href="index\.html" aria-label="Blastrr home">[\s\S]*?<img class="brand-mark" src="\/favicon\.png" alt="" aria-hidden="true">[\s\S]*?<span>BLASTRR<\/span>/);
  assert.match(landingHtml, /<a class="brand" href="index\.html" aria-label="Blastrr home"><img class="brand-mark" src="\/favicon\.png" alt=""><span>BLASTRR<\/span><\/a>/);
  assert.match(landingHtml, /<a class="brand" href="index\.html"><img class="brand-mark" src="\/favicon\.png" alt=""><span>BLASTRR<\/span><\/a>/);
  assert.match(appCss, /\.logo\s*\{[^}]*font-size:\s*20px;[^}]*font-weight:\s*950;[^}]*letter-spacing:\s*0\.08em/);
  assert.match(appCss, /\.logo \.brand-mark\s*\{[^}]*object-fit:\s*cover/);
  assert.match(landingHtml, /\.brand-mark\{object-fit:cover;clip-path:none\}/);
});

test('homepage display font remains distinctive while the app uses the neutral documentation font', () => {
  assert.match(landingHtml, /fonts\.googleapis\.com\/css2\?family=Orbitron/);
  assert.match(landingHtml, /\.brand\{[^}]*font-family:"Orbitron"[^}]*font-style:italic/);
  assert.match(landingHtml, /\.hero h1\{font-family:"Orbitron"[^}]*font-style:italic/);
  assert.match(appCss, /\.logo > span, \.battlepass-page-heading h1 \{[\s\S]*?font-family: Inter/);
  assert.doesNotMatch(appHtml, /fonts\.googleapis\.com\/css2\?family=Orbitron/);
  assert.match(appCss, /body, button, input, select, textarea \{[\s\S]*?font-family: Inter/);
});

test('homepage navigation hover and active states stay transparent with a purple glow', () => {
  assert.match(landingHtml, /\.navlinks a:hover,\.navlinks a:focus-visible,\.navlinks a:active,\.navlinks a\[aria-current="page"\]\{color:#fff;background:transparent;border-color:rgba\(168,85,247,\.85\);box-shadow:0 0 12px rgba\(168,85,247,\.5\)/);
  assert.match(landingHtml, /\.navright>\.btn:hover,\.navright>\.btn:focus-visible,\.navright>\.btn:active,\.menu-toggle:hover[\s\S]*?background:transparent;border:1px solid rgba\(168,85,247,\.85\);color:#fff;box-shadow:0 0 12px rgba\(168,85,247,\.5\)/);
});

test('homepage focuses on crypto markets without promoting derivatives products', () => {
  assert.match(landingHtml, /20 major Binance crypto markets/);
  assert.match(landingHtml, /Crypto trading terminal/);
  assert.doesNotMatch(landingHtml, /perpetual|perps|CME|index contract/i);
  assert.match(landingHtml, /without the scheduled daily sessions and weekly closes typical of many FX and futures markets/);
});

test('terminal surfaces use a black glass theme with restrained neutral borders', () => {
  assert.match(appCss, /--surface-glass: rgba\(10, 11, 12, 0\.94\)/);
  assert.match(appCss, /backdrop-filter: blur\(20px\) saturate\(130%\)/);
  assert.match(appCss, /body:not\(\.auth-locked\) \{ background: #050607; \}/);
  assert.match(appCss, /border: 1px solid rgba\(180, 190, 200, 0\.2\) !important/);
  assert.match(appCss, /box-shadow: 0 0 8px rgba\(180, 190, 200, 0\.14\) !important/);
  assert.match(appCss, /header #nav-menu \{[\s\S]*?backdrop-filter: blur\(24px\) saturate\(145%\)/);
  assert.match(appCss, /\.hamburger-btn\.menu-open \.hamburger-glyph::before \{ transform: rotate\(45deg\); \}/);
  assert.match(appCss, /\.hamburger-btn\.menu-open \.hamburger-glyph::after \{ transform: rotate\(-45deg\); \}/);
  assert.match(appCss, /Neutral documentation-inspired theme shared by every terminal and admin view/);
  assert.match(appCss, /\.admin-section-tab:hover, \.admin-section-tab:focus-visible, \.admin-section-tab\.active \{[\s\S]*?rgba\(180, 190, 200, 0\.28\)/);
  assert.match(appCss, /\.admin-account-card, \.admin-creator-card, \.promo-code-card, \.support-ticket-card/);
  assert.match(appCss, /#wallet-menu \.wallet-menu-account:hover:not\(:disabled\)[\s\S]*?rgba\(200, 210, 220, 0\.38\)/);
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
  assert.match(appJs, /"moving average exponential\.plot\.color":\s*"#b7bdc5"/);
  assert.match(appJs, /"mainSeriesProperties\.candleStyle\.upColor":\s*"#72f0c3"/);
  assert.match(appJs, /"mainSeriesProperties\.candleStyle\.downColor":\s*"#ff638e"/);
  assert.match(appCss, /\.order-actions \.btn-buy\s*\{[^}]*#72f0c3/);
  assert.match(appCss, /\.order-actions \.btn-sell\s*\{[^}]*#ff638e/);
  assert.match(appCss, /\.order-actions button\.btn-buy:not\(\.nav-tab\):not\(\.admin-section-tab\)\s*\{[^}]*rgba\(114, 240, 195, 0\.2\)[^}]*!important/);
  assert.match(appCss, /\.order-actions button\.btn-sell:not\(\.nav-tab\):not\(\.admin-section-tab\)\s*\{[^}]*rgba\(255, 99, 142, 0\.2\)[^}]*!important/);
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
  assert.match(appCss, /@media \(max-width: 700px\) \{[\s\S]*?header \{ flex-wrap: wrap; row-gap: 10px; gap: 10px; padding: 12px; \}[\s\S]*?\.header-actions \{ order: 2; flex: 1 0 100%;[\s\S]*?\.hamburger-btn \{ position: absolute; top: 12px; right: 12px;[\s\S]*?background: rgba\(6, 4, 10, 0\.99\)/);
  assert.match(appCss, /header #nav-menu \.nav-tab:not\(\.active\) \{ color: #e2e8f0; background: transparent; \}/);
  assert.match(appCss, /\.nav-tab:hover, \.nav-tab:focus-visible,[\s\S]*?box-shadow: 0 0 6px rgba\(180, 190, 200, 0\.09\)/);
  assert.match(appCss, /\.admin-section-tab:hover, \.admin-section-tab:focus-visible, \.admin-section-tab\.active \{[\s\S]*?box-shadow: 0 0 6px rgba\(180, 190, 200, 0\.08\)/);
  assert.match(appCss, /button:not\(\.nav-tab\):not\(\.admin-section-tab\)/);
});

test('terminal stays black and locked until a signed wallet session is established', () => {
  assert.match(appHtml, /<body class="auth-locked">[\s\S]*?<section id="wallet-login-gate"/);
  assert.match(appHtml, /<header hidden>/);
  assert.match(appHtml, /<main hidden>/);
  assert.match(appHtml, /onclick="connectWallet\(\)">Connect wallet &amp; sign in/);
  assert.match(appHtml, /id="disclaimer-gate"[^>]*hidden/);
  assert.match(appHtml, /id="disclaimer-scroll-area"/);
  assert.match(appHtml, /id="disclaimer-accept-terms" type="checkbox" disabled/);
  assert.match(appHtml, /id="disclaimer-simulated-funds" type="checkbox" disabled/);
  assert.match(appHtml, /id="disclaimer-remember" type="checkbox" checked/);
  assert.match(appHtml, /id="disclaimer-cancel-purchase"/);
  assert.match(appHtml, /Testimonials &amp; User Submissions/);
  assert.match(appCss, /body\.auth-locked[^}]*background:\s*#000/);
  assert.match(appJs, /if \(!dashboardAuthenticated \|\| !walletSessionToken \|\|[\s\S]*?lockDashboard\(\);[\s\S]*?return;/);
  assert.match(appJs, /await ensureWalletSession\(\);[\s\S]*?walletFetch\('\/api\/user\/disclaimer-consent'\)[\s\S]*?if \(consent\.accepted && consent\.version === DISCLAIMER_VERSION\)[\s\S]*?continueAfterDisclaimer\(\)/);
  assert.match(appJs, /const accountsLoaded = await loadUserAccounts\(connectedWallet\)[\s\S]*?if \(accountsLoaded && userAccounts\.length === 0\) switchView\('buyView'\)/);
  assert.match(appJs, /if \(!res\.ok\) throw new Error\('Unable to load wallet accounts\.'\)[\s\S]*?if \(!Array\.isArray\(data\.accounts\)\) throw new Error\('The wallet account list is unavailable\.'\)[\s\S]*?return true;[\s\S]*?return false;/);
  assert.match(appJs, /scrollArea\.scrollTop \+ scrollArea\.clientHeight >= scrollArea\.scrollHeight - 4/);
  assert.match(appJs, /accepted_terms: true,[\s\S]*?simulated_funds: true/);
  assert.match(appJs, /async function buyPlan\(planId, priceUsdt\)[\s\S]*?requestPurchaseDisclaimer\(\)[\s\S]*?completePlanPurchase\(planId, amount\)/);
  assert.match(appJs, /walletSessionOwner !== owner \|\| walletSessionExpiresAt <= Date\.now\(\)/);
  assert.match(appJs, /async function completePlanPurchase\(planId, amount\)[\s\S]*?Confirm purchase for \$\$\{amount\} USDT[\s\S]*?toTokenUnits\(amount, chainConfig\.decimals\)/);
  assert.match(appJs, /disclaimer_version: DISCLAIMER_VERSION,[\s\S]*?terms_accepted: true,[\s\S]*?simulated_funds_acknowledged: true/);
  assert.match(serverJs, /app\.get\('\/api\/user\/disclaimer-consent', requireWalletSession/);
  assert.match(serverJs, /app\.post\('\/api\/user\/disclaimer-consent', sensitiveLimiter, requireWalletSession/);
  assert.match(serverJs, /wallet_disclaimer_acceptances/);
  assert.match(serverJs, /req\.body\?\.disclaimer_version !== DISCLAIMER_VERSION[\s\S]*?req\.body\?\.terms_accepted !== true[\s\S]*?req\.body\?\.simulated_funds_acknowledged !== true/);
  assert.match(appJs, /if \(dashboardAuthenticated && \(!walletSessionToken \|\| walletSessionExpiresAt <= Date\.now\(\)\)\)/);
});

test('wallet switcher menu lists connected accounts before add and logout actions', () => {
  assert.match(appJs, /availableWallets\.forEach\(address => \{[\s\S]*?accounts\.append\(button\);[\s\S]*?function updateWalletUIState/);
  assert.match(appJs, /function toggleWalletMenu\(\)/);
  assert.match(appJs, /function closeWalletMenu\(\)/);
  assert.match(appHtml, /id="wallet-menu-accounts"[\s\S]*?id="connect-new-btn"[\s\S]*?id="disconnect-btn"/);
  assert.match(appCss, /\.wallet-menu-panel\s*\{[^}]*position: absolute/);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.wallet-menu-panel \{ position: fixed/);
  assert.match(appCss, /#wallet-menu \.wallet-menu-account,[\s\S]*?box-shadow: none !important/);
  assert.match(appCss, /#wallet-menu \.wallet-menu-account:hover:not\(:disabled\),[\s\S]*?#wallet-menu \.wallet-menu-account:active[\s\S]*?box-shadow: 0 0 12px/);
  assert.match(appCss, /#wallet-menu \.wallet-menu-logout:active[\s\S]*?box-shadow: 0 0 12px rgba\(248, 113, 113, 0\.2\)/);
});

test('BlastrrPass content and reward fields wrap without mobile overflow', () => {
  assert.match(appCss, /\.battlepass-task-heading > strong \{[^}]*overflow-wrap: anywhere/);
  assert.match(appCss, /\.battlepass-task-copy p \{[^}]*overflow-wrap: anywhere/);
  assert.match(appCss, /\.battlepass-reward-code \{[^}]*max-width: 100%; overflow-wrap: anywhere/);
  assert.match(appCss, /\.battlepass-x-preview blockquote, \.battlepass-x-preview iframe \{[^}]*max-width: 100% !important/);
  assert.match(appCss, /\.admin-task-form \.form-group \{ flex-basis: 100%; min-width: 0; \}/);
  assert.match(appCss, /\.battlepass-admin-row \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test('accounts, leaderboard, and profile use responsive Battle Pass-style cards', () => {
  assert.match(appHtml, /id="accountsView" class="view-panel workspace-view"/);
  assert.match(appHtml, /id="accounts-portfolio-container" class="account-card-list"/);
  assert.match(appHtml, /id="leaderboardView" class="view-panel workspace-view"/);
  assert.match(appHtml, /id="leaderboard-table-body" class="leaderboard-card-list"/);
  assert.match(appHtml, /id="profileView" class="view-panel workspace-view"/);
  assert.match(appHtml, /id="ref-transactions-list" class="profile-commission-list"/);
  assert.match(appJs, /class="battlepass-task leaderboard-card/);
  assert.match(appJs, /class="account-card"/);
  assert.match(appJs, /class="battlepass-task profile-commission-card"/);
  assert.match(appCss, /\.account-card\s*\{[^}]*border: 1px solid rgba\(203, 213, 225, 0\.095\)[^}]*background: rgba\(4, 3, 7, 0\.82\)/);
  assert.match(appCss, /\.leaderboard-card-list\s*\{[^}]*grid-template-columns: repeat\(auto-fit/);
  assert.match(appCss, /\.battlepass-task\s*\{[\s\S]*?border: 1px solid var\(--surface-border\)[\s\S]*?background: rgba\(5, 7, 11, 0\.38\)/);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.leaderboard-card-stats \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('homepage buttons keep purple styling while terminal buttons use restrained neutral borders', () => {
  const terminalButtonRule = /button:not\(\.nav-tab\):not\(\.admin-section-tab\), input\[type="button"\], input\[type="submit"\], input\[type="reset"\], \.btn\s*\{[\s\S]*?background: transparent !important;[\s\S]*?border: 1px solid rgba\(180, 190, 200, 0\.2\) !important;[\s\S]*?box-shadow: 0 0 4px rgba\(180, 190, 200, 0\.06\) !important/;
  assert.match(appCss, terminalButtonRule);
  assert.match(appCss, /border-color: rgba\(200, 210, 220, 0\.48\) !important;[\s\S]*?box-shadow: 0 0 8px rgba\(180, 190, 200, 0\.14\) !important/);
  assert.match(appCss, /\.nav-tab \{[\s\S]*?background: transparent;[\s\S]*?border-color: transparent;/);
  assert.match(landingHtml, /button,input\[type="button"\],input\[type="submit"\],input\[type="reset"\],\.btn\{background:transparent!important;[\s\S]*?border:1px solid rgba\(168,85,247,\.78\)!important;[\s\S]*?box-shadow:0 0 12px rgba\(168,85,247,\.28\)/);
});

test('NullNet checkout uses the correct chain ID and matching wallet and verification RPC settings', () => {
  assert.match(appJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"[\s\S]*?nativeCurrency: \{ name: "LUN", symbol: "LUN", decimals: 18 \}[\s\S]*?usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b",[\s\S]*?decimals: 18/);
  assert.match(serverJs, /448000:\s*\{[\s\S]*?chainIdHex: "0x6d600"[\s\S]*?rpcUrl: "https:\/\/rpc\.lunul\.org"[\s\S]*?decimals: 18/);
  assert.match(appJs, /const rawAmount = toTokenUnits\(amount, chainConfig\.decimals\)/);
  assert.match(serverJs, /rawValue >= expectedRawValue/);
  assert.match(appJs, /method: 'wallet_addEthereumChain'/);
  assert.match(appJs, /const activeChainId = BigInt\(await provider\.request\(\{ method: 'eth_chainId' \}\)\)/);
});

test('BNB Smart Chain checkout uses BEP-20 USDT and is listed on the payment surfaces', () => {
  const bscUsdt = '0x55d398326f99059fF775485246999027B3197955';
  assert.match(appJs, /56:\s*\{[\s\S]*?name: "BNB Smart Chain"[\s\S]*?chainIdHex: "0x38"[\s\S]*?rpcUrl: "https:\/\/bsc-dataseed\.binance\.org"[\s\S]*?nativeCurrency: \{ name: "BNB", symbol: "BNB", decimals: 18 \}[\s\S]*?usdtAddress: "0x55d398326f99059fF775485246999027B3197955"[\s\S]*?decimals: 18/);
  assert.match(serverJs, /56:\s*\{[\s\S]*?name: "BNB Smart Chain"[\s\S]*?chainIdHex: "0x38"[\s\S]*?usdtAddress: "0x55d398326f99059fF775485246999027B3197955"[\s\S]*?decimals: 18/);
  assert.match(appHtml, /<option value="56">BNB Smart Chain \(BSC\)<\/option>/);
  assert.ok(landingHtml.includes('>BNB Smart Chain</b><small>BEP-20</small>'));
  assert.match(landingHtml, /Six networks\./);
  assert.ok(landingHtml.includes('BNB Smart Chain or NullNet'));
  assert.equal((appJs.match(new RegExp(bscUsdt, 'g')) || []).length, 1);
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
