function calculateTradePerformance(trades = []) {
  const allTrades = Array.isArray(trades) ? trades : [];
  const closedTrades = allTrades
    .filter(trade => trade.status === 'CLOSED')
    .map(trade => Number(trade.pnl))
    .filter(Number.isFinite);
  const winners = closedTrades.filter(pnl => pnl > 0);
  const losers = closedTrades.filter(pnl => pnl < 0);
  const grossProfit = winners.reduce((total, pnl) => total + pnl, 0);
  const grossLoss = Math.abs(losers.reduce((total, pnl) => total + pnl, 0));
  const netRealizedPnl = grossProfit - grossLoss;
  const averageWin = winners.length ? grossProfit / winners.length : null;
  const averageLoss = losers.length ? -grossLoss / losers.length : null;

  return {
    closedTrades: closedTrades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    breakEvenTrades: closedTrades.length - winners.length - losers.length,
    openTrades: allTrades.filter(trade => trade.status === 'OPEN').length,
    pendingOrders: allTrades.filter(trade => trade.status === 'PENDING').length,
    winRatePercent: closedTrades.length ? (winners.length / closedTrades.length) * 100 : null,
    averageWin,
    averageLoss,
    winLossRatio: averageWin != null && averageLoss != null ? averageWin / Math.abs(averageLoss) : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    netRealizedPnl,
    expectancy: closedTrades.length ? netRealizedPnl / closedTrades.length : null,
    bestTrade: closedTrades.length ? Math.max(...closedTrades) : null,
    worstTrade: closedTrades.length ? Math.min(...closedTrades) : null
  };
}

module.exports = { calculateTradePerformance };
