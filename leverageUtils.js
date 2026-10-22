// leverageUtils.js - Dedicated module for leverage calculations, risk metrics, and formatting

export function calculatePositionMetrics(marginInput, leverage, currentLivePrice) {
    const notional = marginInput * leverage;
    const price = currentLivePrice || 0;

    let estLiqPrice = 0;
    if (price > 0 && marginInput > 0 && leverage > 1) {
        // Standard maintenance margin buffer approximation for leveraged perps
        estLiqPrice = price * (1 - (1 / leverage) * 0.9);
    }

    return {
        notional,
        estLiqPrice,
        isLeveraged: leverage > 1
    };
}

export function formatCurrency(amount) {
    return '$' + parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
