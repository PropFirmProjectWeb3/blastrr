const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DLL_LOCK_HOURS,
  advanceRiskBaselines,
  getActiveLock,
  getMllFloor,
  getRiskBreach
} = require('../riskRules');

const plan = { max_drawdown_pct: 10, daily_loss_pct: 5 };

function account(equity) {
  return {
    initial_balance: 1000,
    daily_starting_balance: 1000,
    current_equity: equity
  };
}

test('MLL breaches at the current trailing floor and are permanent', () => {
  assert.deepEqual(getRiskBreach(account(900), plan, 0), {
    reason: 'MLL',
    permanent: true,
    lockedUntil: null
  });
});

test('MLL trails the EOD high-water mark by the initial fixed loss amount and caps at initial capital', () => {
  const funded = { initial_balance: 5000, current_equity: 5100, high_water_mark: 5100 };
  assert.equal(getMllFloor(funded, plan), 4600);
  assert.equal(getRiskBreach({ ...funded, current_equity: 4600 }, plan, 0).reason, 'MLL');

  const capped = { ...funded, current_equity: 5500, high_water_mark: 5500 };
  assert.equal(getMllFloor(capped, plan), 5000);
  assert.equal(getMllFloor({ ...capped, high_water_mark: 6000 }, plan), 5000);
  assert.equal(getRiskBreach({ ...capped, current_equity: 5000 }, plan, 0).reason, 'MLL');
});

test('EOD rollover starts the new DLL from closing equity without changing initial capital', () => {
  const account = {
    initial_balance: 5000,
    current_equity: 5100,
    daily_starting_balance: 5000,
    high_water_mark: 5000,
    risk_day: '2026-01-01'
  };
  const nextDay = advanceRiskBaselines(account, plan, '2026-01-02');
  assert.equal(nextDay.daily_starting_balance, 5100);
  assert.equal(nextDay.high_water_mark, 5100);
  assert.equal(nextDay.risk_day, '2026-01-02');
  assert.equal(account.initial_balance, 5000);
  assert.equal(nextDay.daily_starting_balance * (plan.daily_loss_pct / 100), 255);
});

test('legacy accounts begin tracking without treating an intraday balance as an EOD high', () => {
  const account = {
    initial_balance: 5000,
    current_equity: 5100,
    daily_starting_balance: 5000,
    high_water_mark: 5000,
    risk_day: null
  };
  const baseline = advanceRiskBaselines(account, plan, '2026-01-02');
  assert.equal(baseline.risk_day, '2026-01-02');
  assert.equal(baseline.high_water_mark, 5000);
  assert.equal(baseline.daily_starting_balance, 5000);
});

test('DLL breaches lock for exactly 24 hours unless MLL is also breached', () => {
  const now = Date.UTC(2026, 0, 1);
  const breach = getRiskBreach(account(950), plan, now);
  assert.equal(breach.reason, 'DLL');
  assert.equal(breach.permanent, false);
  assert.equal(Date.parse(breach.lockedUntil) - now, DLL_LOCK_HOURS * 60 * 60 * 1000);
});

test('the harder MLL breach takes precedence over DLL', () => {
  assert.equal(getRiskBreach(account(899), plan, 0).reason, 'MLL');
});

test('risk values below thresholds do not lock an account', () => {
  assert.equal(getRiskBreach(account(951), plan, 0), null);
});

test('expired DLL locks clear while permanent MLL locks never expire', () => {
  const now = Date.UTC(2026, 0, 2);
  assert.equal(getActiveLock({
    lock_reason: 'DLL',
    locked_until: new Date(now - 1).toISOString(),
    permanent_lock: 0
  }, now), null);
  assert.deepEqual(getActiveLock({
    lock_reason: 'MLL',
    locked_until: null,
    permanent_lock: 1
  }, now), { reason: 'MLL', permanent: true, lockedUntil: null });
});
