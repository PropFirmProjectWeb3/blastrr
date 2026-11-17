function resolveStopTargetPrices({
  executionPrice,
  units,
  side,
  mode = 'price',
  sl = null,
  tp = null,
  slAmount = null,
  tpAmount = null
}) {
  const entry = Number(executionPrice);
  const positionUnits = Number(units);
  if (!Number.isFinite(entry) || entry <= 0 ||
      !Number.isFinite(positionUnits) || positionUnits <= 0 ||
      !['BUY', 'SELL'].includes(side) ||
      !['price', 'amount'].includes(mode)) {
    throw new Error('Trade price, size, side, or stop mode is invalid.');
  }

  let stopLoss = sl == null ? null : Number(sl);
  let takeProfit = tp == null ? null : Number(tp);
  if (mode === 'amount') {
    const loss = slAmount == null ? null : Number(slAmount);
    const profit = tpAmount == null ? null : Number(tpAmount);
    if ((loss != null && (!Number.isFinite(loss) || loss <= 0)) ||
        (profit != null && (!Number.isFinite(profit) || profit <= 0))) {
      throw new Error('SL/TP dollar amounts must be positive.');
    }
    stopLoss = loss == null ? null : entry + (side === 'BUY' ? -1 : 1) * (loss / positionUnits);
    takeProfit = profit == null ? null : entry + (side === 'BUY' ? 1 : -1) * (profit / positionUnits);
  }

  if ((stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) ||
      (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0)) ||
      (side === 'BUY' && ((stopLoss != null && stopLoss >= entry) || (takeProfit != null && takeProfit <= entry))) ||
      (side === 'SELL' && ((stopLoss != null && stopLoss <= entry) || (takeProfit != null && takeProfit >= entry)))) {
    throw new Error('Stop loss amount is too large for this position, or a trigger price is invalid for this side.');
  }

  return { sl: stopLoss, tp: takeProfit };
}

function getTriggeredExitPrice({ price, side, sl = null, tp = null }) {
  const marketPrice = Number(price);
  if (!Number.isFinite(marketPrice) || marketPrice <= 0 || !['BUY', 'SELL'].includes(side)) return null;
  const stopLoss = sl == null ? null : Number(sl);
  const takeProfit = tp == null ? null : Number(tp);
  if ((stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) ||
      (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0))) return null;

  if (side === 'BUY') {
    if (stopLoss != null && marketPrice <= stopLoss) return stopLoss;
    if (takeProfit != null && marketPrice >= takeProfit) return takeProfit;
  } else {
    if (stopLoss != null && marketPrice >= stopLoss) return stopLoss;
    if (takeProfit != null && marketPrice <= takeProfit) return takeProfit;
  }
  return null;
}

module.exports = { getTriggeredExitPrice, resolveStopTargetPrices };
