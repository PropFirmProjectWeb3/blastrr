const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appHtml = fs.readFileSync('public/app.html', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const landingHtml = fs.readFileSync('public/index.html', 'utf8');

test('trading terminal HTML loads its external stylesheet and application script', () => {
  assert.match(appHtml, /href="\/css\/app\.css"/);
  assert.match(appHtml, /src="\/js\/app\.js" defer/);
  assert.doesNotMatch(appHtml, /<style[\s>]/i);
  assert.doesNotMatch(appHtml, /<script>\s*[\s\S]*?\bfunction\s/m);
  assert.match(appHtml, /id="nav-menu"/);
  assert.match(appHtml, /id="order-symbol"/);
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

test('account cards expose expandable trade history and daily profit charts', () => {
  assert.match(appJs, /<details class="account-expanded"/);
  assert.match(appJs, /renderDailyProfitChart/);
  assert.match(appJs, /Daily profit by date/);
  assert.match(appJs, /walletFetch\(`\/api\/accounts\/details/);
});

test('browser application files contain no copied provider credentials', () => {
  assert.doesNotMatch(`${appHtml}\n${appJs}`, /alch_[A-Za-z0-9_-]+/);
});
