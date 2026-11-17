function isLimitOrderTriggered(side, limitPrice, marketPrice) {
  const limit = Number(limitPrice);
  const price = Number(marketPrice);
  if (!['BUY', 'SELL'].includes(side) ||
      !Number.isFinite(limit) || limit <= 0 ||
      !Number.isFinite(price) || price <= 0) {
    return false;
  }
  return side === 'BUY' ? price <= limit : price >= limit;
}

module.exports = { isLimitOrderTriggered };
