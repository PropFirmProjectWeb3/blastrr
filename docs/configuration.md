# Trading terminal configuration

The trading terminal shell is in `public/app.html`; presentation styles and behavior live in `public/css/app.css` and `public/js/app.js`. Market options and plan defaults are intentionally kept outside the HTML:

- Edit `public/config/markets.json` to add pairs, choose TradingView symbols, group menu items, and select a quote source. Set `"enabled": false` to hide a pair from new trades while retaining quote support for existing positions.
- Edit `config/plans.json` to change plan prices, simulated capital, targets, and configured risk percentages. On server startup the configured values are synchronized to matching plan rows in SQLite and new configured plans are inserted; plans omitted from the file are retired from the purchase list but retained for existing accounts. Changes to a plan's rules apply to all accounts that reference that plan.

The existing plan definitions use a 5% DLL calculated from the current daily starting balance and a 10% MLL loss amount fixed from initial capital. At each UTC day rollover, the DLL starting balance resets to the prior day's closing equity. The MLL loss amount stays fixed, while its high-water mark trails up from end-of-day equity and is capped at initial capital plus that loss amount. For a $5,000 account, the $500 MLL trail therefore stops at $5,500 and its breach floor stops at $5,000. Profit target/progress remains calculated from initial capital. A DLL breach locks the account for 24 hours; an MLL breach permanently locks it. A server-side UTC rollover runs every minute and saves daily balance/profit summaries for the account chart; account detail/trade requests also catch up a missed rollover.

Accounts display as compact cards with capital, balance, profit, and risk previews. Expand a card to see the daily profit graph and trade history. The graph refreshes along with account data while the Accounts view is open.

Private account, trade, and referral reads require a wallet-signed bearer session that expires after 15 minutes. The browser obtains a new session when needed; changing or disconnecting wallets discards the in-memory token.

Prices and trading remain simulated. Binance spot and perpetual prices are polled directly by the user's browser. To prevent a modified client price from changing balances, the server also makes a fresh public Binance quote request only when a trade is opened or closed. This low-frequency integrity check requires no private API key. TradFi entries marked `SIMULATED` are deterministic simulated prices, not live provider data. Browser-side stop-loss/take-profit monitoring requires the terminal to remain open and wallet approval to submit the close.

This is not a financial-grade execution or risk system. A production live-trading service would need trusted market-data and order-execution infrastructure, plus an always-on server-side stop engine. `max_single_day_profit_pct` remains configurable because the repository does not define an enforcement outcome for breaching that rule.

On-chain purchase verification uses public RPC endpoints by default. Operators can override these server-side with `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `POLYGON_RPC_URL`, and `AVALANCHE_RPC_URL`; keep provider credentials in the server environment, never in browser assets.
