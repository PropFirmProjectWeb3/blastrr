const test = require('node:test');
const assert = require('node:assert/strict');
const { compute } = require('../public/js/chartIndicators');

function risingCandles(count = 40) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return {
      time: 1_700_000_000 + index * 60,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: index + 1
    };
  });
}

test('overlay indicators calculate SMA, EMA, Bollinger Bands, and session VWAP', () => {
  const candles = risingCandles();
  const sma = compute('SMA', candles, { period: 3 }).series[0].data;
  const ema = compute('EMA', candles, { period: 3 }).series[0].data;
  const bands = compute('BOLLINGER', candles, { period: 2, deviation: 2 }).series;
  const vwap = compute('VWAP', candles).series[0].data;

  assert.equal(sma[1].value, undefined);
  assert.equal(sma[2].value, 101);
  assert.equal(ema[2].value, 101);
  assert.equal(ema[3].value, 102);
  assert.equal(bands[0].data[1].value, 101.5);
  assert.equal(bands[2].data[1].value, 99.5);
  assert.ok(Math.abs(vwap[1].value - ((100 * 1 + 101 * 2) / 3)) < 1e-10);
});

test('volume, oscillators, and trend indicators return aligned pane series', () => {
  const candles = risingCandles();
  for (const type of ['VOLUME', 'RSI', 'MACD', 'STOCHASTIC', 'ATR', 'ADX', 'CCI', 'OBV']) {
    const result = compute(type, candles);
    assert.equal(result.pane, true, type);
    assert.ok(result.series.length > 0, type);
    for (const series of result.series) {
      assert.equal(series.data.length, candles.length, `${type} ${series.name}`);
      assert.deepEqual(series.data.map(point => point.time), candles.map(candle => candle.time));
    }
  }

  assert.equal(compute('VOLUME', candles).series[0].data[0].value, 1);
  assert.equal(compute('RSI', candles, { period: 14 }).series[0].data[14].value, 100);
  assert.equal(compute('ATR', candles, { period: 14 }).series[0].data[13].value, 2);
  assert.equal(compute('ADX', candles, { period: 14 }).series[0].data[27].value, 100);
  assert.ok(Math.abs(compute('STOCHASTIC', candles, { k: 14, d: 3 }).series[0].data[13].value - (14 / 15 * 100)) < 1e-10);
  assert.equal(compute('OBV', candles).series[0].data[1].value, 2);
});

test('indicator calculations handle short history and unknown names without invalid values', () => {
  const candles = risingCandles(5);
  for (const type of ['SMA', 'EMA', 'BOLLINGER', 'VWAP', 'VOLUME', 'RSI', 'MACD', 'STOCHASTIC', 'ATR', 'ADX', 'CCI', 'OBV']) {
    const result = compute(type, candles);
    for (const series of result.series) {
      for (const point of series.data) {
        assert.ok(point.time);
        assert.ok(point.value === undefined || Number.isFinite(point.value));
      }
    }
  }
  assert.deepEqual(compute('NOT_AN_INDICATOR', candles), { pane: false, series: [] });
  assert.deepEqual(compute('RSI', []), { pane: false, series: [] });
});
