const { EventEmitter } = require('events');

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

class MarketDataService extends EventEmitter {
  constructor({ markets, providers, now = Date.now, onProviderError = console.warn }) {
    super();
    this.marketsBySymbol = new Map((markets || []).map(market => [market.symbol, market]));
    this.providers = providers || {};
    this.now = now;
    this.onProviderError = onProviderError;
    this.latestQuotes = new Map();
    this.providerStops = [];
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const marketsBySource = new Map();
    for (const market of this.marketsBySymbol.values()) {
      if (!market.source) continue;
      if (!marketsBySource.has(market.source)) marketsBySource.set(market.source, []);
      marketsBySource.get(market.source).push(market);
    }

    for (const [source, markets] of marketsBySource) {
      const provider = this.providers[source];
      if (!provider || typeof provider.start !== 'function') {
        this.reportProviderError(source, null, new Error('No market data provider is registered.'));
        continue;
      }
      try {
        const stop = provider.start(
          markets,
          quote => this.publish(source, quote),
          (error, symbol = null) => this.reportProviderError(source, symbol, error)
        );
        if (typeof stop === 'function') this.providerStops.push(stop);
      } catch (error) {
        this.reportProviderError(source, null, error);
      }
    }
  }

  stop() {
    for (const stop of this.providerStops.splice(0)) stop();
    this.started = false;
  }

  publish(source, update) {
    if (!update || typeof update !== 'object') return false;
    const market = this.marketsBySymbol.get(update?.symbol);
    if (!market || market.source !== source) return false;
    const price = optionalNumber(update.price);
    if (!Number.isFinite(price) || price <= 0) return false;

    const receivedAt = this.now();
    const publishedAt = optionalNumber(update.publishedAt ?? update.publishTime) || receivedAt;
    const quote = Object.freeze({
      symbol: market.symbol,
      pair: market.pair,
      source,
      assetClass: market.asset_class || (market.type === 'FOREX' ? 'FOREX' : market.type === 'CFD' ? 'CFD' : 'CRYPTO'),
      type: market.type || null,
      price,
      bid: optionalNumber(update.bid),
      ask: optionalNumber(update.ask),
      publishedAt,
      publishTime: publishedAt,
      receivedAt,
      priceChangePercent: optionalNumber(update.priceChangePercent),
      highPrice: optionalNumber(update.highPrice),
      lowPrice: optionalNumber(update.lowPrice),
      quoteVolume: optionalNumber(update.quoteVolume)
    });

    const previous = this.latestQuotes.get(market.symbol);
    if (previous && quote.publishedAt < previous.publishedAt) return false;
    if (previous && quote.publishedAt === previous.publishedAt &&
        quote.price === previous.price && quote.bid === previous.bid && quote.ask === previous.ask &&
        quote.priceChangePercent === previous.priceChangePercent && quote.highPrice === previous.highPrice &&
        quote.lowPrice === previous.lowPrice && quote.quoteVolume === previous.quoteVolume) {
      return false;
    }

    this.latestQuotes.set(market.symbol, quote);
    this.emit('quote', quote);
    return true;
  }

  getQuote(symbol, maxAgeMs = 5000) {
    const quote = this.latestQuotes.get(symbol);
    if (!quote) throw new Error(`No live market price is available for ${symbol}.`);
    const ageMs = this.now() - quote.publishedAt;
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || ageMs < -5000 || ageMs > maxAgeMs) {
      throw new Error(`The market price for ${symbol} is stale.`);
    }
    return quote;
  }

  getLatestQuotes() {
    return Array.from(this.latestQuotes.values());
  }

  reportProviderError(source, symbol, error) {
    const providerError = {
      source,
      symbol,
      error: error instanceof Error ? error : new Error(String(error))
    };
    this.onProviderError(providerError);
    this.emit('providerError', providerError);
  }
}

module.exports = { MarketDataService };
