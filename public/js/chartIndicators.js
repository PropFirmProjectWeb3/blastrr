(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ChartIndicatorCalculations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const COLORS = {
        primary: '#fbbf24',
        secondary: '#38bdf8',
        tertiary: '#c084fc',
        volumeUp: '#72f0c3',
        volumeDown: '#ff638e'
    };

    function rollingMean(values, period) {
        const result = Array(values.length).fill(null);
        let sum = 0;
        let valid = 0;
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index];
            if (Number.isFinite(value)) {
                sum += value;
                valid += 1;
            }
            const expired = values[index - period];
            if (Number.isFinite(expired)) {
                sum -= expired;
                valid -= 1;
            }
            if (index >= period - 1 && valid === period) result[index] = sum / period;
        }
        return result;
    }

    function ema(values, period) {
        const result = Array(values.length).fill(null);
        const multiplier = 2 / (period + 1);
        let seed = [];
        let previous = null;
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index];
            if (!Number.isFinite(value)) continue;
            if (previous === null) {
                seed.push(value);
                if (seed.length === period) {
                    previous = seed.reduce((total, item) => total + item, 0) / period;
                    result[index] = previous;
                }
                continue;
            }
            previous = (value - previous) * multiplier + previous;
            result[index] = previous;
        }
        return result;
    }

    function line(name, color, candles, values) {
        return {
            name,
            type: 'line',
            color,
            data: candles.map((candle, index) => Number.isFinite(values[index])
                ? { time: candle.time, value: values[index] }
                : { time: candle.time })
        };
    }

    function compute(type, candles, params = {}) {
        if (!Array.isArray(candles) || !candles.length) return { pane: false, series: [] };
        const closes = candles.map(candle => Number(candle.close));
        const period = Math.max(2, Math.floor(Number(params.period) || 14));
        const values = [];
        switch (type) {
            case 'SMA':
                return { pane: false, series: [line(`SMA ${period}`, COLORS.primary, candles, rollingMean(closes, period))] };
            case 'EMA':
                return { pane: false, series: [line(`EMA ${period}`, COLORS.secondary, candles, ema(closes, period))] };
            case 'BOLLINGER': {
                const middle = rollingMean(closes, period);
                const deviation = Math.max(0.1, Number(params.deviation) || 2);
                const upper = closes.map((_, index) => {
                    if (!Number.isFinite(middle[index])) return null;
                    const slice = closes.slice(index - period + 1, index + 1);
                    const variance = slice.reduce((sum, value) => sum + ((value - middle[index]) ** 2), 0) / period;
                    return middle[index] + deviation * Math.sqrt(variance);
                });
                const lower = upper.map((value, index) => Number.isFinite(value) ? 2 * middle[index] - value : null);
                return {
                    pane: false,
                    series: [
                        line(`BB upper ${period}`, COLORS.secondary, candles, upper),
                        line(`BB basis ${period}`, COLORS.primary, candles, middle),
                        line(`BB lower ${period}`, COLORS.secondary, candles, lower)
                    ]
                };
            }
            case 'VWAP': {
                let day = null;
                let cumulativeVolume = 0;
                let cumulativeValue = 0;
                const vwap = candles.map(candle => {
                    const currentDay = Math.floor(candle.time / 86400);
                    if (currentDay !== day) {
                        day = currentDay;
                        cumulativeVolume = 0;
                        cumulativeValue = 0;
                    }
                    const volume = Number(candle.volume);
                    if (!Number.isFinite(volume) || volume <= 0) return null;
                    const typical = (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3;
                    cumulativeVolume += volume;
                    cumulativeValue += typical * volume;
                    return cumulativeValue / cumulativeVolume;
                });
                return { pane: false, series: [line('Session VWAP', COLORS.tertiary, candles, vwap)] };
            }
            case 'VOLUME':
                return {
                    pane: true,
                    series: [{
                        name: 'Volume',
                        type: 'histogram',
                        data: candles.map(candle => ({
                            time: candle.time,
                            value: Math.max(0, Number(candle.volume) || 0),
                            color: candle.close >= candle.open ? COLORS.volumeUp : COLORS.volumeDown
                        }))
                    }]
                };
            case 'RSI': {
                const rsiPeriod = period;
                const rsi = Array(candles.length).fill(null);
                if (candles.length > rsiPeriod) {
                    let gains = 0;
                    let losses = 0;
                    for (let index = 1; index <= rsiPeriod; index += 1) {
                        const change = closes[index] - closes[index - 1];
                        gains += Math.max(change, 0);
                        losses += Math.max(-change, 0);
                    }
                    let averageGain = gains / rsiPeriod;
                    let averageLoss = losses / rsiPeriod;
                    rsi[rsiPeriod] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
                    for (let index = rsiPeriod + 1; index < candles.length; index += 1) {
                        const change = closes[index] - closes[index - 1];
                        averageGain = (averageGain * (rsiPeriod - 1) + Math.max(change, 0)) / rsiPeriod;
                        averageLoss = (averageLoss * (rsiPeriod - 1) + Math.max(-change, 0)) / rsiPeriod;
                        rsi[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
                    }
                }
                return { pane: true, series: [line(`RSI ${rsiPeriod}`, COLORS.primary, candles, rsi)] };
            }
            case 'MACD': {
                const fastPeriod = Math.max(2, Math.floor(Number(params.fast) || 12));
                const slowPeriod = Math.max(fastPeriod + 1, Math.floor(Number(params.slow) || 26));
                const signalPeriod = Math.max(2, Math.floor(Number(params.signal) || 9));
                const fast = ema(closes, fastPeriod);
                const slow = ema(closes, slowPeriod);
                const macd = closes.map((_, index) => Number.isFinite(fast[index]) && Number.isFinite(slow[index])
                    ? fast[index] - slow[index]
                    : null);
                const signal = ema(macd, signalPeriod);
                const histogram = macd.map((value, index) => Number.isFinite(value) && Number.isFinite(signal[index])
                    ? { time: candles[index].time, value: value - signal[index], color: value >= signal[index] ? COLORS.volumeUp : COLORS.volumeDown }
                    : { time: candles[index].time });
                return {
                    pane: true,
                    series: [
                        line('MACD', COLORS.secondary, candles, macd),
                        line('Signal', COLORS.primary, candles, signal),
                        { name: 'Histogram', type: 'histogram', data: histogram }
                    ]
                };
            }
            case 'STOCHASTIC': {
                const kPeriod = Math.max(2, Math.floor(Number(params.k) || 14));
                const dPeriod = Math.max(2, Math.floor(Number(params.d) || 3));
                const kValues = candles.map((candle, index) => {
                    if (index < kPeriod - 1) return null;
                    const sample = candles.slice(index - kPeriod + 1, index + 1);
                    const highest = Math.max(...sample.map(item => Number(item.high)));
                    const lowest = Math.min(...sample.map(item => Number(item.low)));
                    return highest === lowest ? 50 : ((closes[index] - lowest) / (highest - lowest)) * 100;
                });
                return {
                    pane: true,
                    series: [
                        line('%K', COLORS.secondary, candles, kValues),
                        line('%D', COLORS.primary, candles, rollingMean(kValues, dPeriod))
                    ]
                };
            }
            case 'ATR': {
                const trueRanges = candles.map((candle, index) => {
                    if (index === 0) return Number(candle.high) - Number(candle.low);
                    const previousClose = closes[index - 1];
                    return Math.max(
                        Number(candle.high) - Number(candle.low),
                        Math.abs(Number(candle.high) - previousClose),
                        Math.abs(Number(candle.low) - previousClose)
                    );
                });
                const atr = Array(candles.length).fill(null);
                if (candles.length >= period) {
                    let previous = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
                    atr[period - 1] = previous;
                    for (let index = period; index < candles.length; index += 1) {
                        previous = ((previous * (period - 1)) + trueRanges[index]) / period;
                        atr[index] = previous;
                    }
                }
                return { pane: true, series: [line(`ATR ${period}`, COLORS.primary, candles, atr)] };
            }
            case 'ADX': {
                const length = period;
                const tr = Array(candles.length).fill(0);
                const positive = Array(candles.length).fill(0);
                const negative = Array(candles.length).fill(0);
                for (let index = 1; index < candles.length; index += 1) {
                    const current = candles[index];
                    const previous = candles[index - 1];
                    const up = Number(current.high) - Number(previous.high);
                    const down = Number(previous.low) - Number(current.low);
                    positive[index] = up > down && up > 0 ? up : 0;
                    negative[index] = down > up && down > 0 ? down : 0;
                    tr[index] = Math.max(
                        Number(current.high) - Number(current.low),
                        Math.abs(Number(current.high) - closes[index - 1]),
                        Math.abs(Number(current.low) - closes[index - 1])
                    );
                }
                const adx = Array(candles.length).fill(null);
                if (candles.length >= length * 2) {
                    let smoothedTr = tr.slice(1, length + 1).reduce((sum, value) => sum + value, 0);
                    let smoothedPositive = positive.slice(1, length + 1).reduce((sum, value) => sum + value, 0);
                    let smoothedNegative = negative.slice(1, length + 1).reduce((sum, value) => sum + value, 0);
                    const dx = Array(candles.length).fill(null);
                    for (let index = length; index < candles.length; index += 1) {
                        if (index > length) {
                            smoothedTr = smoothedTr - smoothedTr / length + tr[index];
                            smoothedPositive = smoothedPositive - smoothedPositive / length + positive[index];
                            smoothedNegative = smoothedNegative - smoothedNegative / length + negative[index];
                        }
                        const plusDi = smoothedTr ? 100 * smoothedPositive / smoothedTr : 0;
                        const minusDi = smoothedTr ? 100 * smoothedNegative / smoothedTr : 0;
                        const denominator = plusDi + minusDi;
                        dx[index] = denominator ? 100 * Math.abs(plusDi - minusDi) / denominator : 0;
                    }
                    const firstAdxIndex = length * 2 - 1;
                    let initial = 0;
                    for (let index = length; index <= firstAdxIndex; index += 1) initial += dx[index] || 0;
                    let previousAdx = initial / length;
                    adx[firstAdxIndex] = previousAdx;
                    for (let index = firstAdxIndex + 1; index < candles.length; index += 1) {
                        previousAdx = ((previousAdx * (length - 1)) + (dx[index] || 0)) / length;
                        adx[index] = previousAdx;
                    }
                }
                return { pane: true, series: [line(`ADX ${length}`, COLORS.primary, candles, adx)] };
            }
            case 'CCI': {
                const typical = candles.map(candle =>
                    (Number(candle.high) + Number(candle.low) + Number(candle.close)) / 3
                );
                const means = rollingMean(typical, period);
                const cci = typical.map((value, index) => {
                    if (!Number.isFinite(means[index])) return null;
                    const sample = typical.slice(index - period + 1, index + 1);
                    const meanDeviation = sample.reduce((sum, item) => sum + Math.abs(item - means[index]), 0) / period;
                    return meanDeviation ? (value - means[index]) / (0.015 * meanDeviation) : 0;
                });
                return { pane: true, series: [line(`CCI ${period}`, COLORS.primary, candles, cci)] };
            }
            case 'OBV': {
                let obv = 0;
                const values = candles.map((candle, index) => {
                    const volume = Math.max(0, Number(candle.volume) || 0);
                    if (index > 0) {
                        if (closes[index] > closes[index - 1]) obv += volume;
                        else if (closes[index] < closes[index - 1]) obv -= volume;
                    }
                    return obv;
                });
                return { pane: true, series: [line('OBV', COLORS.primary, candles, values)] };
            }
            default:
                return { pane: false, series: [] };
        }
    }

    return { compute };
});
