const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const plans = require('../config/plans.json');
const markets = require('../public/config/markets.json');
const serverJs = fs.readFileSync('server.js', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');

test('all supported-chain purchases use the same treasury recipient in the client and verifier', () => {
  const treasury = '0xFBD3B9bA404f590b9A7b35B72104bEff9DEa5503';
  assert.match(serverJs, new RegExp(`const TREASURY_WALLET = '${treasury}'`));
  assert.match(appJs, new RegExp(`const TREASURY_WALLET = "${treasury}"`));
  assert.match(serverJs, /verifyMultiChainPurchase\(tx_hash, Number\(chain_id\), wallet_address, finalPrice, TREASURY_WALLET\)/);
  assert.match(appJs, /const paddedRecipient = TREASURY_WALLET\.toLowerCase\(\)/);
});

test('plan configuration preserves existing seed limits and valid values', () => {
  assert.equal(plans.length, 6);
  const names = new Set();
  for (const plan of plans) {
    assert.ok(plan.name);
    assert.ok(!names.has(plan.name), `duplicate plan name: ${plan.name}`);
    names.add(plan.name);
    for (const key of [
      'base_price_usdt',
      'price_usdt',
      'simulated_capital',
      'profit_target',
      'max_drawdown_pct',
      'daily_loss_pct',
      'max_single_day_profit_pct'
    ]) {
      assert.ok(Number.isFinite(plan[key]) && plan[key] > 0, `${plan.name} has invalid ${key}`);
    }
    assert.equal(plan.max_drawdown_pct, 10);
    assert.equal(plan.daily_loss_pct, 5);
  }
  assert.equal(plans.find(plan => plan.name === 'Whale $250k').simulated_capital, 250000);
});

test('market configuration exposes only the top Binance USDT crypto spot selection', () => {
  assert.equal(markets.length, 20);
  const symbols = new Set();
  for (const market of markets) {
    assert.ok(market.label && market.symbol && market.pair && market.group);
    assert.ok(!symbols.has(market.symbol), `duplicate market symbol: ${market.symbol}`);
    symbols.add(market.symbol);
    assert.equal(market.source, 'BINANCE_SPOT');
    assert.equal(market.type, 'SPOT');
    assert.equal(market.group, 'Spot Crypto (Binance)');
    assert.ok(market.pair.endsWith('USDT'));
    assert.equal(market.symbol, `BINANCE:${market.pair}`);
  }
  assert.deepEqual(markets.map(({ pair }) => pair), [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'SOLUSDT',
    'TRXUSDT', 'ZECUSDT', 'HYPEUSDT', 'DOGEUSDT', 'LINKUSDT',
    'ADAUSDT', 'NEARUSDT', 'XLMUSDT', 'BCHUSDT', 'LTCUSDT',
    'UNIUSDT', 'AVAXUSDT', 'SUIUSDT', 'HBARUSDT', 'SHIBUSDT'
  ]);
});
