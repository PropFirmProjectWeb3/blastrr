const DLL_LOCK_HOURS = 24;

function getRiskBalance(account) {
  const explicitRiskBalance = account.risk_balance == null ? NaN : Number(account.risk_balance);
  if (Number.isFinite(explicitRiskBalance)) return explicitRiskBalance;
  const balance = account.current_balance == null ? NaN : Number(account.current_balance);
  if (Number.isFinite(balance)) return balance;
  return Number(account.current_equity);
}

function calculateUnrealizedPnl(trade, currentPrice) {
  const price = Number(currentPrice);
  const entryPrice = Number(trade.entry_price);
  const units = Number(trade.units);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(units) || units <= 0 || !['BUY', 'SELL'].includes(trade.side)) {
    throw new Error('Cannot calculate live risk from an invalid trade or market price.');
  }
  return (trade.side === 'BUY' ? price - entryPrice : entryPrice - price) * units;
}

function getTradeMargin(trade) {
  const margin = Number(trade.size_usd);
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error('Cannot calculate live risk from invalid trade margin.');
  }
  return margin;
}

function getLiveRiskBalance(account, openTrades, pricesBySymbol) {
  const hasCashBalance = account.current_balance != null;
  const baseEquity = !hasCashBalance
    ? Number(account.current_equity)
    : Number(account.current_balance);
  if (!Number.isFinite(baseEquity)) throw new Error('Cannot calculate live risk without a valid account equity.');
  return baseEquity + openTrades.reduce((total, trade) => {
    if (!pricesBySymbol.has(trade.symbol)) {
      throw new Error(`Cannot calculate live risk without a price for ${trade.symbol}.`);
    }
    const reservedMargin = hasCashBalance ? getTradeMargin(trade) : 0;
    return total + reservedMargin + calculateUnrealizedPnl(trade, pricesBySymbol.get(trade.symbol));
  }, 0);
}

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
  const riskBalance = getRiskBalance(account);
  const storedHighWaterMark = Math.min(
    trailingCap,
    Math.max(account.initial_balance, Number(account.high_water_mark) || account.initial_balance)
  );

  if (!account.risk_day) {
    return {
      risk_day: today,
      daily_starting_balance: riskBalance,
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
    Math.max(storedHighWaterMark, riskBalance)
  );
  return {
    risk_day: today,
    daily_starting_balance: riskBalance,
    high_water_mark: highWaterMark
  };
}

function getRiskBreach(account, plan, now = Date.now()) {
  const riskBalance = getRiskBalance(account);
  const dailyLossLimit = account.daily_starting_balance * (plan.daily_loss_pct / 100);
  const mllFloor = getMllFloor(account, plan);
  const dailyLoss = account.daily_starting_balance - riskBalance;

  if (riskBalance <= mllFloor) {
    return { reason: 'MLL', permanent: true, lockedUntil: null };
  }
  if (dailyLoss >= dailyLossLimit) {
    const utcMidnight = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() + 1
    );
    return {
      reason: 'DLL',
      permanent: false,
      lockedUntil: new Date(Math.min(now + DLL_LOCK_HOURS * 60 * 60 * 1000, utcMidnight)).toISOString()
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

module.exports = {
  DLL_LOCK_HOURS,
  advanceRiskBaselines,
  calculateUnrealizedPnl,
  getActiveLock,
  getLiveRiskBalance,
  getMllFloor,
  getRiskBalance,
  getRiskBreach,
  getTradeMargin
};
