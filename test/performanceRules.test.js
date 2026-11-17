const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTradePerformance } = require('../performanceRules');

test('performance summary uses closed PnL and excludes open and pending trades from win metrics', () => {
  assert.deepEqual(calculateTradePerformance([
    { status: 'CLOSED', pnl: 120 },
    { status: 'CLOSED', pnl: -40 },
    { status: 'CLOSED', pnl: 0 },
    { status: 'OPEN', pnl: 500 },
    { status: 'PENDING', pnl: 300 }
  ]), {
    closedTrades: 3,
    winningTrades: 1,
    losingTrades: 1,
    breakEvenTrades: 1,
    openTrades: 1,
    pendingOrders: 1,
    winRatePercent: (1 / 3) * 100,
    averageWin: 120,
    averageLoss: -40,
    winLossRatio: 3,
    profitFactor: 3,
    netRealizedPnl: 80,
    expectancy: 80 / 3,
    bestTrade: 120,
    worstTrade: -40
  });
});

test('performance summary returns empty metrics for accounts without trades', () => {
  assert.deepEqual(calculateTradePerformance(), {
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    openTrades: 0,
    pendingOrders: 0,
    winRatePercent: null,
    averageWin: null,
    averageLoss: null,
    winLossRatio: null,
    profitFactor: null,
    netRealizedPnl: 0,
    expectancy: null,
    bestTrade: null,
    worstTrade: null
  });
});
