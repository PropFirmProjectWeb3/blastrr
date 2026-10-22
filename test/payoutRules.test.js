const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getProtectedPayoutBalance,
  getAvailableGrossWithdrawal,
  splitWithdrawal
} = require('../payoutRules');

test('payout eligibility protects the capped MLL amount and only exposes excess', () => {
  const protectedBalance = getProtectedPayoutBalance(5000, 10);
  assert.equal(protectedBalance, 5500);
  assert.equal(getAvailableGrossWithdrawal(5500, protectedBalance), 0);
  assert.equal(getAvailableGrossWithdrawal(5600, protectedBalance), 100);
  assert.equal(getAvailableGrossWithdrawal(5600, protectedBalance, 25), 75);
});

test('payout floor rounds up and available gross rounds down to cents', () => {
  const protectedBalance = getProtectedPayoutBalance(5000.05, 10);
  assert.equal(protectedBalance, 5500.06);
  assert.equal(getAvailableGrossWithdrawal(5600.05, protectedBalance), 99.99);
});

test('payout split rounds to cents while preserving the full gross deduction', () => {
  assert.deepEqual(splitWithdrawal(100), {
    gross: 100,
    userAmount: 90,
    adminShare: 10
  });
  assert.deepEqual(splitWithdrawal(10.01), {
    gross: 10.01,
    userAmount: 9.01,
    adminShare: 1
  });
});

test('payout rule helpers reject invalid risk and payout values', () => {
  assert.throws(() => getProtectedPayoutBalance(5000, -1), TypeError);
  assert.throws(() => getAvailableGrossWithdrawal(100, 50, -1), TypeError);
  assert.throws(() => splitWithdrawal(0), TypeError);
});
