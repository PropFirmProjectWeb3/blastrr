const DLL_LOCK_HOURS = 24;

function getMllFloor(account, plan) {
  const maxLoss = account.initial_balance * (plan.max_drawdown_pct / 100);
  const trailingCap = account.initial_balance + maxLoss;
  const highWaterMark = Math.min(
    trailingCap,
    Math.max(account.initial_balance, Number(account.high_water_mark) || account.initial_balance)
  );
  return Math.min(account.initial_balance, highWaterMark - maxLoss);
}

function advanceRiskBaselines(account, plan, today) {
  const maxLoss = account.initial_balance * (plan.max_drawdown_pct / 100);
  const trailingCap = account.initial_balance + maxLoss;
  const storedHighWaterMark = Math.min(
    trailingCap,
    Math.max(account.initial_balance, Number(account.high_water_mark) || account.initial_balance)
  );

  if (!account.risk_day) {
    return {
      risk_day: today,
      daily_starting_balance: account.daily_starting_balance,
      high_water_mark: storedHighWaterMark
    };
  }
  if (account.risk_day === today) {
    return {
      risk_day: today,
      daily_starting_balance: account.daily_starting_balance,
      high_water_mark: account.high_water_mark
    };
  }
  const highWaterMark = Math.min(
    trailingCap,
    Math.max(storedHighWaterMark, account.current_equity)
  );
  return {
    risk_day: today,
    daily_starting_balance: account.current_equity,
    high_water_mark: highWaterMark
  };
}

function getRiskBreach(account, plan, now = Date.now()) {
  const dailyLossLimit = account.daily_starting_balance * (plan.daily_loss_pct / 100);
  const mllFloor = getMllFloor(account, plan);
  const dailyLoss = account.daily_starting_balance - account.current_equity;

  if (account.current_equity <= mllFloor) {
    return { reason: 'MLL', permanent: true, lockedUntil: null };
  }
  if (dailyLoss >= dailyLossLimit) {
    return {
      reason: 'DLL',
      permanent: false,
      lockedUntil: new Date(now + DLL_LOCK_HOURS * 60 * 60 * 1000).toISOString()
    };
  }
  return null;
}

function getActiveLock(account, now = Date.now()) {
  if (account.lock_reason === 'MLL' || Number(account.permanent_lock) === 1) {
    return { reason: 'MLL', permanent: true, lockedUntil: null };
  }
  if (account.lock_reason === 'DLL' && account.locked_until) {
    const lockedUntil = Date.parse(account.locked_until);
    if (Number.isFinite(lockedUntil) && lockedUntil > now) {
      return { reason: 'DLL', permanent: false, lockedUntil: account.locked_until };
    }
  }
  return null;
}

module.exports = { DLL_LOCK_HOURS, advanceRiskBaselines, getActiveLock, getMllFloor, getRiskBreach };
