function getProtectedPayoutBalance(initialBalance, maxDrawdownPct) {
  if (!Number.isFinite(Number(initialBalance)) || Number(initialBalance) < 0 ||
      !Number.isFinite(Number(maxDrawdownPct)) || Number(maxDrawdownPct) < 0) {
    throw new TypeError('Payout balance and MLL percentage must be non-negative numbers.');
  }
  const floor = Number(initialBalance) * (1 + Number(maxDrawdownPct) / 100);
  return Math.ceil((floor - 1e-9) * 100) / 100;
}

function getAvailableGrossWithdrawal(balance, protectedBalance, pendingAmount = 0) {
  const values = [balance, protectedBalance, pendingAmount].map(Number);
  if (values.some(value => !Number.isFinite(value)) || values[2] < 0) {
    throw new TypeError('Balance, protected balance, and pending withdrawal amount must be finite.');
  }
  const available = values[0] - values[1] - values[2];
  return Math.max(0, Math.floor((available + 1e-9) * 100) / 100);
}

function splitWithdrawal(grossAmount) {
  const grossCents = Math.round(Number(grossAmount) * 100);
  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    throw new TypeError('Withdrawal amount must be a positive number.');
  }
  const userCents = Math.round(grossCents * 0.9);
  return {
    gross: grossCents / 100,
    userAmount: userCents / 100,
    adminShare: (grossCents - userCents) / 100
  };
}

module.exports = {
  getProtectedPayoutBalance,
  getAvailableGrossWithdrawal,
  splitWithdrawal
};
