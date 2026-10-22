const test = require('node:test');
const assert = require('node:assert/strict');
const plans = require('../config/plans.json');
const markets = require('../public/config/markets.json');

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
});

test('market configuration has unique symbols and supported price sources', () => {
  const symbols = new Set();
  for (const market of markets) {
    assert.ok(market.label && market.symbol && market.pair && market.group);
    assert.ok(!symbols.has(market.symbol), `duplicate market symbol: ${market.symbol}`);
    symbols.add(market.symbol);
    assert.ok(['BINANCE_SPOT', 'BINANCE_PERP', 'SIMULATED'].includes(market.source));
    if (market.source === 'SIMULATED') {
      assert.ok(Number.isFinite(market.base) && Number.isFinite(market.amplitude));
    }
  }
});
