# Trading terminal configuration

The trading terminal shell is in `public/app.html`; presentation styles and behavior live in `public/css/app.css` and `public/js/app.js`. Market options and plan defaults are intentionally kept outside the HTML:

- Edit `public/config/markets.json` to add pairs, choose TradingView symbols, group menu items, and select a quote source. Set `"enabled": false` to hide a pair from new trades while retaining quote support for existing positions.
- Edit `config/plans.json` to change plan prices, simulated capital, targets, and configured risk percentages. On server startup the configured values are synchronized to matching plan rows in SQLite and new configured plans are inserted; plans omitted from the file are retired from the purchase list but retained for existing accounts. Changes to a plan's rules apply to all accounts that reference that plan.

The existing plan definitions use a 5% daily loss limit and a 10% static maximum drawdown. A DLL breach locks the account for 24 hours; when the lock expires, the daily starting equity is reset. A max-drawdown/MLL breach permanently locks the account. These checks run on the server when trades settle and the server also refuses new trades on an already-breached account.

Private account, trade, and referral reads require a wallet-signed bearer session that expires after 15 minutes. The browser obtains a new session when needed; changing or disconnecting wallets discards the in-memory token.

Prices and trading remain simulated. Binance spot and perpetual prices are polled directly by the user's browser. To prevent a modified client price from changing balances, the server also makes a fresh public Binance quote request only when a trade is opened or closed. This low-frequency integrity check requires no private API key. TradFi entries marked `SIMULATED` are deterministic simulated prices, not live provider data. Browser-side stop-loss/take-profit monitoring requires the terminal to remain open and wallet approval to submit the close.

This is not a financial-grade execution or risk system. A production live-trading service would need trusted market-data and order-execution infrastructure, plus an always-on server-side stop engine. `max_single_day_profit_pct` remains configurable because the repository does not define an enforcement outcome for breaching that rule.

On-chain purchase verification uses public RPC endpoints by default. Operators can override these server-side with `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `POLYGON_RPC_URL`, and `AVALANCHE_RPC_URL`; keep provider credentials in the server environment, never in browser assets.
