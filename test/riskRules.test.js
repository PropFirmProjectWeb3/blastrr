const test = require('node:test');
const assert = require('node:assert/strict');
const { DLL_LOCK_HOURS, getActiveLock, getRiskBreach } = require('../riskRules');

const plan = { max_drawdown_pct: 10, daily_loss_pct: 5 };

function account(equity) {
  return {
    initial_balance: 1000,
    daily_starting_balance: 1000,
    current_equity: equity
  };
}

test('MLL breaches at the static maximum drawdown and are permanent', () => {
  assert.deepEqual(getRiskBreach(account(900), plan, 0), {
    reason: 'MLL',
    permanent: true,
    lockedUntil: null
  });
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
