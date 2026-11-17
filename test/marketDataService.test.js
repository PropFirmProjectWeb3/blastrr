const test = require('node:test');
const assert = require('node:assert/strict');
const { MarketDataService } = require('../marketDataService');

test('market data service groups instruments and fans each provider quote into a shared snapshot', () => {
  const providerGroups = [];
  const providers = {
    BINANCE_SPOT: {
      start(markets, publish) {
        providerGroups.push(markets);
        publish({
          symbol: 'BINANCE:BTCUSDT',
          price: 65000,
          bid: 64999,
          ask: 65001,
          publishedAt: 1000,
          priceChangePercent: 1.25
        });
        return () => {};
      }
    }
  };
  const service = new MarketDataService({
    now: () => 1100,
    markets: [
      { symbol: 'BINANCE:BTCUSDT', pair: 'BTCUSDT', source: 'BINANCE_SPOT', type: 'SPOT' },
      { symbol: 'BINANCE:ETHUSDT', pair: 'ETHUSDT', source: 'BINANCE_SPOT', type: 'SPOT' }
    ],
    providers
  });
  const updates = [];
  service.on('quote', quote => updates.push(quote));

  service.start();

  assert.equal(providerGroups.length, 1);
  assert.equal(providerGroups[0].length, 2);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].assetClass, 'CRYPTO');
  assert.equal(service.getQuote('BINANCE:BTCUSDT', 500).price, 65000);
  service.stop();
});

test('market data service rejects stale, missing, and out-of-order prices', () => {
  let now = 1000;
  const service = new MarketDataService({
    now: () => now,
    markets: [{ symbol: 'FX:EURUSD', pair: 'EUR/USD', source: 'SWISSQUOTE', asset_class: 'FOREX' }],
    providers: {}
  });

  assert.throws(() => service.getQuote('FX:EURUSD', 30000), /No live market price/);
  assert.equal(service.publish('SWISSQUOTE', {
    symbol: 'FX:EURUSD',
    price: 1.08,
    bid: 1.0799,
    ask: 1.0801,
    publishedAt: 1000
  }), true);
  assert.equal(service.publish('SWISSQUOTE', {
    symbol: 'FX:EURUSD',
    price: 1.07,
    publishedAt: 900
  }), false);
  assert.equal(service.getQuote('FX:EURUSD', 30000).price, 1.08);

  now = 31001;
  assert.throws(() => service.getQuote('FX:EURUSD', 30000), /price .* is stale/);
});
