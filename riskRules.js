const DLL_LOCK_HOURS = 24;

function getRiskBreach(account, plan, now = Date.now()) {
  const maxDrawdown = account.initial_balance * (plan.max_drawdown_pct / 100);
  const dailyLossLimit = account.daily_starting_balance * (plan.daily_loss_pct / 100);
  const totalLoss = account.initial_balance - account.current_equity;
  const dailyLoss = account.daily_starting_balance - account.current_equity;

  if (totalLoss >= maxDrawdown) {
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

module.exports = { DLL_LOCK_HOURS, getActiveLock, getRiskBreach };
