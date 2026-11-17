const https = require('https');
const WebSocket = require('ws');
const { parseSwissquotePrice } = require('./forexRules');

const POLL_INTERVAL_MS = 1000;

function requestJson(url, { headers = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, timeout: timeoutMs }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Market provider returned HTTP ${response.statusCode}.`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Unable to parse market provider response: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Market provider request timed out.')));
    request.on('error', reject);
  });
}

function createPollingProvider(loadQuote, intervalMs = POLL_INTERVAL_MS) {
  return {
    start(markets, publish, reportError) {
      let stopped = false;
      let timer = null;
      let inFlight = false;

      const poll = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        await Promise.all(markets.map(async market => {
          try {
            publish(await loadQuote(market));
          } catch (error) {
            reportError(error, market.symbol);
          }
        }));
        inFlight = false;
        if (!stopped) timer = setTimeout(poll, intervalMs);
      };

      poll();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }
  };
}

function createBinanceTickerProvider({ endpoint, WebSocketClient }) {
  return {
    start(markets, publish, reportError) {
      if (!markets.length) return () => {};
      const marketsByPair = new Map(markets.map(market => [market.pair, market]));
      const streams = markets.map(market => `${market.pair.toLowerCase()}@ticker`).join('/');
      const url = `${endpoint}/stream?streams=${streams}`;
      let stopped = false;
      let reconnectTimer = null;
      let reconnectAttempts = 0;
      let socket = null;

      const scheduleReconnect = () => {
        if (stopped || reconnectTimer) return;
        const delay = Math.min(30000, 1000 * (2 ** reconnectAttempts));
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      };

      const connect = () => {
        if (stopped) return;
        try {
          socket = new WebSocketClient(url);
        } catch (error) {
          reportError(error);
          scheduleReconnect();
          return;
        }
        socket.on('open', () => { reconnectAttempts = 0; });
        socket.on('message', message => {
          try {
            const ticker = JSON.parse(message.toString())?.data;
            const market = marketsByPair.get(ticker?.s);
            if (!market) return;
            publish({
              symbol: market.symbol,
              price: ticker.c,
              bid: ticker.b,
              ask: ticker.a,
              publishedAt: ticker.E ?? ticker.T,
              priceChangePercent: ticker.P,
              highPrice: ticker.h,
              lowPrice: ticker.l,
              quoteVolume: ticker.q
            });
          } catch (error) {
            reportError(error);
          }
        });
        socket.on('error', error => reportError(error));
        socket.on('close', scheduleReconnect);
      };

      connect();
      return () => {
        stopped = true;
        clearTimeout(reconnectTimer);
        socket?.close();
      };
    }
  };
}

function createSwissquoteProvider() {
  return createPollingProvider(async market => {
    const pairPath = market.pair.split('/').map(encodeURIComponent).join('/');
    const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${pairPath}`;
    const quote = parseSwissquotePrice(await requestJson(url));
    return {
      symbol: market.symbol,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      publishedAt: quote.publishedAt
    };
  });
}

function createBitgetTickerProvider() {
  return createPollingProvider(async market => {
    const url = `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(market.pair)}`;
    const payload = await requestJson(url);
    if (payload.code !== '00000') {
      throw new Error(`Bitget market provider error: ${payload.msg || payload.code}.`);
    }
    const ticker = payload.data?.[0];
    if (ticker?.symbol !== market.pair) throw new Error('Bitget returned an unexpected market symbol.');
    const price = Number(ticker.markPrice ?? ticker.lastPr);
    const open = Number(ticker.open24h);
    return {
      symbol: market.symbol,
      price,
      bid: ticker.bidPr,
      ask: ticker.askPr,
      publishedAt: ticker.ts,
      priceChangePercent: Number.isFinite(open) && open > 0 ? (price / open - 1) * 100 : null,
      highPrice: ticker.high24h,
      lowPrice: ticker.low24h,
      quoteVolume: ticker.usdtVolume ?? ticker.quoteVolume
    };
  });
}

function createSimulatedProvider() {
  return {
    start(markets, publish) {
      const emitQuotes = () => {
        const now = Date.now();
        for (const market of markets) {
          const price = Number((market.base + Math.sin(now / 2000) * market.amplitude).toFixed(2));
          publish({ symbol: market.symbol, price, publishedAt: now });
        }
      };
      emitQuotes();
      const timer = setInterval(emitQuotes, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }
  };
}

function createMarketDataProviders({ WebSocketClient = WebSocket } = {}) {
  return {
    BINANCE_SPOT: createBinanceTickerProvider({
      endpoint: 'wss://stream.binance.com:9443',
      WebSocketClient
    }),
    BINANCE_PERP: createBinanceTickerProvider({
      endpoint: 'wss://fstream.binance.com',
      WebSocketClient
    }),
    BITGET_PERP: createBitgetTickerProvider(),
    SIMULATED: createSimulatedProvider(),
    SWISSQUOTE: createSwissquoteProvider()
  };
}

module.exports = { createMarketDataProviders };
