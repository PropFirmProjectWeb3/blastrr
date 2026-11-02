const express = require('express');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { ethers } = require('ethers');
const db = require('./database');
const defaultPlans = require('./config/plans.json');
const markets = require('./public/config/markets.json');
const {
  advanceRiskBaselines,
  calculateUnrealizedPnl,
  getActiveLock,
  getLiveRiskBalance,
  getMllFloor,
  getRiskBalance,
  getRiskBreach,
  getTradeMargin
} = require('./riskRules');
const { getProtectedPayoutBalance, getAvailableGrossWithdrawal, splitWithdrawal } = require('./payoutRules');

const app = express();
const PORT = process.env.PORT || 4480;

const TREASURY_WALLET = '0x8632fa855d5dc6b59a3cf892d72cf4a94f182aae';

// --- SUPPORTED EVM CHAINS CONFIGURATION ---
const SUPPORTED_EVM_CHAINS = {
    1: {
        name: "Ethereum Mainnet",
        chainIdHex: "0x1",
        rpcUrl: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com",
        usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        decimals: 6
    },
    8453: {
        name: "Base",
        chainIdHex: "0x2105",
        rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        usdtAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
        decimals: 6
    },
    137: {
        name: "Polygon PoS",
        chainIdHex: "0x89",
        rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
        usdtAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        decimals: 6
    },
    43114: {
        name: "Avalanche C-Chain",
        chainIdHex: "0xa86a",
        rpcUrl: process.env.AVALANCHE_RPC_URL || "https://avalanche-c-chain-rpc.publicnode.com",
        usdtAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
        decimals: 6
    },
    56: {
        name: "BNB Smart Chain",
        chainIdHex: "0x38",
        rpcUrl: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
        usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18
    },
    448000: {
        name: "NullNet Private EVM",
        chainIdHex: "0x6d600",
        rpcUrl: "https://rpc.lunul.org",
        usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b", // Your deployed contract address
        decimals: 18
    }
};

// --- 1. PROXY TRUST CONFIGURATION ---
app.set('trust proxy', 'loopback');

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. IP-BASED RATE LIMITER & BINANCE CACHE ---
const requestMap = new Map();

function createRateLimiter(maxRequests = 40, windowMs = 60000) {
    return (req, res, next) => {
        const clientIp = req.ip || 'unknown';
        const now = Date.now();

        if (!requestMap.has(clientIp)) {
            requestMap.set(clientIp, { count: 1, windowStart: now });
            return next();
        }

        const data = requestMap.get(clientIp);
        if (now - data.windowStart > windowMs) {
            data.count = 1;
            data.windowStart = now;
            return next();
        }

        data.count++;
        if (data.count > maxRequests) {
            console.warn(`[RATE LIMIT] Blocked IP ${clientIp} for exceeding ${maxRequests} requests.`);
            return res.status(429).json({ success: false, error: "Too many requests from your IP. Please slow down." });
        }

        next();
    };
}

const sensitiveLimiter = createRateLimiter(30, 60000);

function seedPlans() {
  const syncNextPlan = (index) => {
    if (index === defaultPlans.length) {
      const whalePlan = defaultPlans.find(plan => plan.name === 'Whale $250k');
      if (!whalePlan || whalePlan.simulated_capital !== 250000) {
        console.error('Unable to correct untouched Whale accounts because the configured capital is unexpected.');
        return;
      }
      return db.run(
        `UPDATE accounts
         SET initial_balance = ?, current_balance = ?, current_equity = ?,
             high_water_mark = ?, daily_starting_balance = ?
         WHERE plan_id = (SELECT id FROM plans WHERE name = ? ORDER BY id LIMIT 1)
           AND status = 'ACTIVE' AND COALESCE(permanent_lock, 0) = 0
           AND lock_reason IS NULL AND COALESCE(admin_frozen, 0) = 0
           AND initial_balance = 250050 AND current_balance = 250050
           AND current_equity = 250050 AND high_water_mark = 250050
           AND daily_starting_balance = 250050
           AND NOT EXISTS (SELECT 1 FROM trades WHERE trades.account_id = accounts.id)
           AND NOT EXISTS (SELECT 1 FROM withdrawals WHERE withdrawals.account_id = accounts.id)`,
        [
          whalePlan.simulated_capital,
          whalePlan.simulated_capital,
          whalePlan.simulated_capital,
          whalePlan.simulated_capital,
          whalePlan.simulated_capital,
          whalePlan.name
        ],
        function(migrationErr) {
          if (migrationErr) return console.error('Unable to correct untouched Whale account balances:', migrationErr.message);
          if (this.changes) console.log(`Corrected ${this.changes} untouched Whale account balance(s) to $${whalePlan.simulated_capital}.`);
          db.run(
            `INSERT OR IGNORE INTO battlepass_plan_rewards (plan_id, xp_reward, points_reward)
             SELECT id, 1000, 100 FROM plans WHERE active = 1`,
            (rewardErr) => {
              if (rewardErr) return console.error('Unable to initialize battle pass plan rewards:', rewardErr.message);
              console.log(`Synchronized ${defaultPlans.length} plan definitions from config/plans.json.`);
            }
          );
        }
      );
      return;
    }
    const plan = defaultPlans[index];
    db.get("SELECT id FROM plans WHERE name = ? ORDER BY id LIMIT 1", [plan.name], (lookupErr, existing) => {
      if (lookupErr) return console.error('Unable to look up configured plan', lookupErr.message);
      const values = [
        plan.base_price_usdt,
        plan.price_usdt,
        plan.simulated_capital,
        plan.profit_target,
        plan.max_drawdown_pct,
        plan.daily_loss_pct,
        plan.max_single_day_profit_pct
      ];
      if (existing) {
        db.run(
          `UPDATE plans SET base_price_usdt = ?, price_usdt = ?, simulated_capital = ?,
           profit_target = ?, max_drawdown_pct = ?, daily_loss_pct = ?, max_single_day_profit_pct = ?, active = 1
           WHERE id = ?`,
          [...values, existing.id],
          function(updateErr) {
            if (updateErr) return console.error(`Unable to sync plan ${plan.name}`, updateErr.message);
            syncNextPlan(index + 1);
          }
        );
        return;
      }
      db.run(
        `INSERT INTO plans (name, base_price_usdt, price_usdt, simulated_capital, profit_target,
         max_drawdown_pct, daily_loss_pct, max_single_day_profit_pct, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [plan.name, ...values],
        (insertErr) => {
          if (insertErr) return console.error(`Unable to seed plan ${plan.name}`, insertErr.message);
          syncNextPlan(index + 1);
        }
      );
    });
  };
  db.run('UPDATE plans SET active = 0', (deactivateErr) => {
    if (deactivateErr) return console.error('Unable to retire unconfigured plans', deactivateErr.message);
    syncNextPlan(0);
  });
}

setTimeout(seedPlans, 1000);

const tradeChallenges = new Map();
const walletSessions = new Map();
const WALLET_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const marketPriceCache = new Map();
// Resolve retired symbols only for existing open trades; new orders use markets from markets.json.
const legacyTradeMarkets = new Map([
  ['BINANCE:BTCUSDT', { source: 'BINANCE_SPOT', pair: 'BTCUSDT' }],
  ['BINANCE:ETHUSDT', { source: 'BINANCE_SPOT', pair: 'ETHUSDT' }],
  ['BINANCE:SOLUSDT', { source: 'BINANCE_SPOT', pair: 'SOLUSDT' }],
  ['BINANCE:BTCUSDT.P', { source: 'BINANCE_PERP', pair: 'BTCUSDT' }],
  ['BINANCE:ETHUSDT.P', { source: 'BINANCE_PERP', pair: 'ETHUSDT' }],
  ['BINANCE:SOLUSDT.P', { source: 'BINANCE_PERP', pair: 'SOLUSDT' }],
  ['BYBIT:XAUUSDT.P', { source: 'BITGET_PERP', pair: 'XAUUSDT' }],
  ['BYBIT:XAGUSDT.P', { source: 'BITGET_PERP', pair: 'XAGUSDT' }],
  ['CAPITALCOM:US100', { source: 'BITGET_PERP', pair: 'NDX100USDT' }],
  ['TVC:USOIL', { source: 'SIMULATED', pair: 'CL', base: 72, amplitude: 0.8 }]
]);

function getTradeMarket(symbol) {
  return markets.find(item => item.symbol === symbol) || legacyTradeMarkets.get(symbol);
}

function getAuthoritativePrice(market) {
  if (market.source === 'SIMULATED') {
    const wave = Math.sin(Date.now() / 2000) * market.amplitude;
    return Promise.resolve(Number((market.base + wave).toFixed(2)));
  }
  if (!['BINANCE_SPOT', 'BINANCE_PERP', 'BITGET_PERP'].includes(market.source)) {
    return Promise.reject(new Error(`Unsupported market source: ${market.source}`));
  }

  const cacheKey = `${market.source}:${market.pair}`;
  const cached = marketPriceCache.get(cacheKey);
  if (cached?.price && cached.expiresAt > Date.now()) return Promise.resolve(cached.price);
  if (cached?.promise) return cached.promise;

  let url;
  if (market.source === 'BINANCE_PERP') {
    url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(market.pair)}`;
  } else if (market.source === 'BINANCE_SPOT') {
    url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(market.pair)}`;
  } else if (market.source === 'BITGET_PERP') {
    url = `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(market.pair)}`;
  }
  const pricePromise = new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Market provider returned HTTP ${response.statusCode}.`));
        try {
          const parsed = JSON.parse(body);
          let priceValue;
          if (market.source === 'BITGET_PERP') {
            if (parsed.code !== '00000') return reject(new Error(`Bitget market provider error: ${parsed.msg || parsed.code}.`));
            const ticker = parsed.data?.[0];
            if (ticker?.symbol !== market.pair) return reject(new Error('Bitget returned an unexpected market symbol.'));
            priceValue = ticker.markPrice;
          } else {
            priceValue = parsed.price;
          }
          const price = Number(priceValue);
          if (!Number.isFinite(price) || price <= 0) return reject(new Error('Market provider returned an invalid price.'));
          resolve(price);
        } catch (error) {
          reject(new Error(`Unable to parse market provider response: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Market price request timed out.')));
    request.on('error', reject);
  });
  marketPriceCache.set(cacheKey, { promise: pricePromise });
  pricePromise.then((price) => {
    marketPriceCache.set(cacheKey, { price, expiresAt: Date.now() + 2000 });
  }).catch(() => {
    marketPriceCache.delete(cacheKey);
  });
  return pricePromise;
}

function loadAccountWithLiveRisk(accountId, callback) {
  db.get(
    `SELECT a.*, p.name AS plan_name, p.profit_target, p.simulated_capital,
     p.max_drawdown_pct, p.daily_loss_pct,
     COALESCE((SELECT SUM(w.amount) FROM withdrawals w
       WHERE w.account_id = a.id AND w.status = 'PENDING'), 0) AS pending_withdrawal_amount
     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
    [accountId],
    (accountErr, account) => {
      if (accountErr) return callback(accountErr);
      if (!account) return callback(new Error('Account not found.'));
      db.all(
        `SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'`,
        [accountId],
        (tradesErr, trades) => {
          if (tradesErr) return callback(tradesErr);
          const openTrades = trades || [];
          const marketsBySymbol = new Map();
          for (const trade of openTrades) {
            const market = getTradeMarket(trade.symbol);
            if (!market) return callback(new Error(`Open trade market is not configured: ${trade.symbol}`));
            marketsBySymbol.set(trade.symbol, market);
          }
          Promise.all([...marketsBySymbol].map(async ([symbol, market]) => [symbol, await getAuthoritativePrice(market)]))
            .then((prices) => {
              const pricesBySymbol = new Map(prices);
              account.risk_balance = getLiveRiskBalance(account, openTrades, pricesBySymbol);
              account.open_trades = openTrades.map(trade => {
                const currentPrice = pricesBySymbol.get(trade.symbol);
                return {
                  ...trade,
                  current_price: currentPrice,
                  live_pnl: calculateUnrealizedPnl(trade, currentPrice)
                };
              });
              callback(null, account);
            })
            .catch(callback);
        }
      );
    }
  );
}

function requireTradeSignature(req, res, next) {
  const { wallet_address: wallet, signature, challenge } = req.body;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) ||
      typeof signature !== 'string' || typeof challenge !== 'string') {
    return res.status(401).json({ error: 'A signed wallet challenge is required.' });
  }

  const key = wallet.toLowerCase();
  const stored = tradeChallenges.get(challenge);
  tradeChallenges.delete(challenge);
  if (!stored || stored.walletAddress !== key || stored.expiresAt <= Date.now()) {
    return res.status(401).json({ error: 'Wallet challenge expired or already used.' });
  }

  try {
    if (ethers.verifyMessage(stored.message, signature).toLowerCase() !== key) {
      return res.status(401).json({ error: 'Wallet signature does not match.' });
    }
  } catch {
    return res.status(401).json({ error: 'Wallet signature is invalid.' });
  }
  next();
}

function requireWalletSession(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
  const session = match && walletSessions.get(match[1]);
  if (!session || session.expiresAt <= Date.now()) {
    if (match) walletSessions.delete(match[1]);
    return res.status(401).json({ error: 'A valid wallet session is required.' });
  }
  const requestedWallet = req.body?.wallet_address || req.query.wallet;
  if (requestedWallet && (
    typeof requestedWallet !== 'string' ||
    !ethers.isAddress(requestedWallet) ||
    requestedWallet.toLowerCase() !== session.walletAddress
  )) {
    return res.status(403).json({ error: 'Wallet session does not match the requested wallet.' });
  }
  req.walletAddress = session.walletAddress;
  next();
}

function lockAccount(accountId, breach, callback) {
  const status = breach.permanent ? 'PERMANENTLY_LOCKED' : 'LOCKED';
  db.run(
    `UPDATE accounts SET status = ?, lock_reason = ?, locked_until = ?, permanent_lock = ?
     WHERE id = ? AND NOT (COALESCE(permanent_lock, 0) = 1 AND ? = 0)`,
    [status, breach.reason, breach.lockedUntil, breach.permanent ? 1 : 0, accountId, breach.permanent ? 1 : 0],
    function(updateErr) {
      if (updateErr) return callback(updateErr);
      if (this.changes > 0) return callback(null, breach);
      db.get(
        `SELECT lock_reason, locked_until, permanent_lock FROM accounts WHERE id = ?`,
        [accountId],
        (selectErr, row) => {
          if (selectErr) return callback(selectErr);
          if (!row) return callback(new Error('Account not found while applying risk lock.'));
          callback(null, getActiveLock(row) || breach);
        }
      );
    }
  );
}

function settleBreachWithinTransaction(account, breach, callback) {
  const openTrades = account.open_trades || [];
  const settleNext = (index) => {
    if (index >= openTrades.length) {
      return lockAccount(account.id, breach, (lockErr, appliedLock) => {
        if (lockErr) return callback(lockErr);
        account.status = appliedLock.permanent ? 'PERMANENTLY_LOCKED' : 'LOCKED';
        account.lock_reason = appliedLock.reason;
        account.locked_until = appliedLock.lockedUntil;
        account.permanent_lock = appliedLock.permanent ? 1 : 0;
        callback(null, appliedLock);
      });
    }

    const trade = openTrades[index];
    if (trade.current_price == null || !Number.isFinite(Number(trade.current_price)) ||
        Number(trade.current_price) <= 0 || trade.live_pnl == null ||
        !Number.isFinite(Number(trade.live_pnl))) {
      return callback(new Error(`Cannot close breached account trade ${trade.id} without its live price.`));
    }
    const returnedMargin = getTradeMargin(trade) + Number(trade.live_pnl);
    db.run(
      `UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'OPEN'`,
      [trade.live_pnl, trade.id],
      function(updateErr) {
        if (updateErr) return callback(updateErr);
        if (this.changes === 0) return settleNext(index + 1);
        db.run(
          `UPDATE accounts
           SET current_balance = COALESCE(current_balance, 0) + ?,
               current_equity = COALESCE(current_equity, 0) + ?
           WHERE id = ?`,
          [returnedMargin, trade.live_pnl, account.id],
          (balanceErr) => {
            if (balanceErr) return callback(balanceErr);
            settleNext(index + 1);
          }
        );
      }
    );
  };
  settleNext(0);
}

function applyRiskBreach(account, breach, callback) {
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return callback(beginErr);
      settleBreachWithinTransaction(account, breach, (settleErr) => {
        if (settleErr) return db.run('ROLLBACK', () => callback(settleErr));
        db.run('COMMIT', (commitErr) => {
          if (commitErr) return db.run('ROLLBACK', () => callback(commitErr));
          callback(null, account.lock_reason === 'MLL'
            ? { reason: 'MLL', permanent: true, lockedUntil: null }
            : breach);
        });
      });
    });
  });
}

function refreshRiskBaselines(accountId, callback) {
  const today = new Date().toISOString().slice(0, 10);
  const selectAccount = (done) => loadAccountWithLiveRisk(accountId, done);
  selectAccount((initialErr, initialAccount) => {
    if (initialErr) return callback(initialErr);
    if (!initialAccount) return callback(new Error('Account not found.'));
    if (initialAccount.risk_day === today) return callback(null, initialAccount);

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return callback(beginErr);
        const rollback = (err) => db.run('ROLLBACK', () => callback(err));
        selectAccount((accountErr, account) => {
          if (accountErr) return rollback(accountErr);
          if (!account) return rollback(new Error('Account not found.'));
          if (account.risk_day === today) {
            return db.run('COMMIT', (commitErr) => commitErr ? callback(commitErr) : callback(null, account));
          }

          const baselines = advanceRiskBaselines(account, account, today);
          const updateAccount = () => db.run(
            `UPDATE accounts SET risk_day = ?, daily_starting_balance = ?, high_water_mark = ?
             WHERE id = ?`,
            [baselines.risk_day, baselines.daily_starting_balance, baselines.high_water_mark, accountId],
            function(updateErr) {
              if (updateErr) return rollback(updateErr);
              Object.assign(account, baselines);
              const breach = getRiskBreach(account, account);
              const commit = () => db.run('COMMIT', (commitErr) => {
                if (commitErr) return callback(commitErr);
                callback(null, account);
              });
              if (!breach) return commit();
              settleBreachWithinTransaction(account, breach, (lockErr) => {
                if (lockErr) return rollback(lockErr);
                commit();
              });
            }
          );

          if (!account.risk_day) return updateAccount();
          db.run(
            `INSERT OR REPLACE INTO daily_account_summaries
             (account_id, day, opening_balance, closing_balance, profit)
             VALUES (?, ?, ?, ?, ?)`,
            [
              accountId,
              account.risk_day,
              account.daily_starting_balance,
              getRiskBalance(account),
              getRiskBalance(account) - account.daily_starting_balance
            ],
            (summaryErr) => {
              if (summaryErr) return rollback(summaryErr);
              updateAccount();
            }
          );
        });
      });
    });
  });
}

let riskRolloverInProgress = false;
function rolloverAccountsAtUtcDay() {
  if (riskRolloverInProgress) return;
  riskRolloverInProgress = true;
  const today = new Date().toISOString().slice(0, 10);
  db.all(
    'SELECT id FROM accounts WHERE risk_day IS NULL OR risk_day < ? ORDER BY id',
    [today],
    (err, accounts) => {
      if (err) {
        riskRolloverInProgress = false;
        return console.error('Unable to find accounts for daily risk rollover:', err.message);
      }
      const processNext = (index) => {
        if (index >= accounts.length) {
          riskRolloverInProgress = false;
          return;
        }
        refreshRiskBaselines(accounts[index].id, (rolloverErr) => {
          if (rolloverErr) console.error(`Unable to roll risk baselines for account ${accounts[index].id}:`, rolloverErr.message);
          processNext(index + 1);
        });
      };
      processNext(0);
    }
  );
}

setTimeout(rolloverAccountsAtUtcDay, 5000);
setInterval(rolloverAccountsAtUtcDay, 60 * 1000);

let liveRiskCheckInProgress = false;
function checkLiveRiskLimits() {
  if (liveRiskCheckInProgress) return;
  liveRiskCheckInProgress = true;
  db.all(
    `SELECT DISTINCT a.id FROM accounts a
     JOIN trades t ON t.account_id = a.id AND t.status = 'OPEN'
     WHERE (a.status = 'ACTIVE' AND a.permanent_lock = 0)
        OR a.lock_reason IN ('DLL', 'MLL')
     ORDER BY a.id`,
    [],
    (err, accounts) => {
      if (err) {
        liveRiskCheckInProgress = false;
        return console.error('Unable to find accounts with open trades for live risk checks:', err.message);
      }
      const processNext = (index) => {
        if (index >= accounts.length) {
          liveRiskCheckInProgress = false;
          return;
        }
        const accountId = accounts[index].id;
        refreshRiskBaselines(accountId, (baselineErr, account) => {
          if (baselineErr) {
            console.error(`Unable to calculate live risk for account ${accountId}:`, baselineErr.message);
            return processNext(index + 1);
          }
          refreshAccountLock(account, (lockErr) => {
            if (lockErr) console.error(`Unable to apply live risk lock for account ${accountId}:`, lockErr.message);
            processNext(index + 1);
          });
        });
      };
      processNext(0);
    }
  );
}

setTimeout(checkLiveRiskLimits, 2000);
setInterval(checkLiveRiskLimits, 5000);

let dllUnlockSweepInProgress = false;
function unlockExpiredDllAccounts() {
  if (dllUnlockSweepInProgress) return;
  dllUnlockSweepInProgress = true;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  db.all(
    `SELECT id FROM accounts
     WHERE lock_reason = 'DLL' AND permanent_lock = 0
       AND (locked_until <= ? OR risk_day < ? OR risk_day IS NULL)
     ORDER BY id`,
    [now, today],
    (err, accounts) => {
      if (err) {
        dllUnlockSweepInProgress = false;
        return console.error('Unable to find expired DLL account locks:', err.message);
      }
      const processNext = (index) => {
        if (index >= accounts.length) {
          dllUnlockSweepInProgress = false;
          return;
        }
        const accountId = accounts[index].id;
        refreshRiskBaselines(accountId, (baselineErr, account) => {
          if (baselineErr) {
            console.error(`Unable to refresh expired DLL account ${accountId}:`, baselineErr.message);
            return processNext(index + 1);
          }
          unlockExpiredAccount(account, (unlockErr, activeLock) => {
            if (unlockErr) console.error(`Unable to unlock expired DLL account ${accountId}:`, unlockErr.message);
            if (activeLock) {
              if (account.open_trades?.length) {
                return applyRiskBreach(account, activeLock, (closeErr) => {
                  if (closeErr) console.error(`Unable to close trades for locked account ${accountId}:`, closeErr.message);
                  processNext(index + 1);
                });
              }
              return processNext(index + 1);
            }
            refreshAccountLock(account, (riskErr) => {
              if (riskErr) console.error(`Unable to recheck account ${accountId} after DLL unlock:`, riskErr.message);
              processNext(index + 1);
            });
          });
        });
      };
      processNext(0);
    }
  );
}

setTimeout(unlockExpiredDllAccounts, 2000);
setInterval(unlockExpiredDllAccounts, 5000);

function unlockExpiredAccount(account, callback) {
  const lock = getActiveLock(account);
  if (lock) return callback(null, lock);
  if (account.lock_reason === 'DLL') {
    return db.run(
      `UPDATE accounts SET status = 'ACTIVE', daily_starting_balance = ?,
       lock_reason = NULL, locked_until = NULL
       WHERE id = ? AND permanent_lock = 0`,
      [getRiskBalance(account), account.id],
      (err) => {
        if (!err) {
          account.status = 'ACTIVE';
          account.daily_starting_balance = getRiskBalance(account);
          account.lock_reason = null;
          account.locked_until = null;
        }
        callback(err, null);
      }
    );
  }
  callback(null, null);
}

function refreshAccountLock(account, callback) {
  unlockExpiredAccount(account, (unlockErr, activeLock) => {
    if (unlockErr) return callback(unlockErr);
    if (activeLock) {
      if (!account.open_trades?.length) return callback(null, activeLock);
      return applyRiskBreach(account, activeLock, callback);
    }
    const breach = getRiskBreach(account, account);
    if (!breach) return callback(null, null);
    applyRiskBreach(account, breach, callback);
  });
}

function requireAdminWallet(req, res, next) {
  const wallet = req.body?.wallet_address;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return res.status(401).json({ error: 'Administrator wallet is required.' });
  }
  db.get(
    "SELECT role FROM admins WHERE LOWER(wallet_address) = LOWER(?)",
    [wallet],
    (err, admin) => {
      if (err) return res.status(500).json({ error: 'Unable to verify administrator role.' });
      if (!admin || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
        return res.status(403).json({ error: 'Administrator access required.' });
      }
      next();
    }
  );
}

function getBattlePassLevel(xp) {
  return Math.min(12, Math.floor(Math.max(0, Number(xp) || 0) / 10000));
}

function getBattlePassPeriodKey(cadence, date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (cadence === 'DAILY') return `${year}-${month}-${day}`;
  if (cadence === 'MONTHLY') return `${year}-${month}`;
  const monday = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

function getBattlePassPeriodEnd(cadence, periodKey) {
  const [year, month, day] = periodKey.split('-').map(Number);
  const end = cadence === 'MONTHLY'
    ? new Date(Date.UTC(year, month, 1))
    : new Date(Date.UTC(year, month - 1, day + (cadence === 'WEEKLY' ? 7 : 1)));
  return end.toISOString().slice(0, 10);
}

function getBattlePassTaskPeriod(task, date = new Date()) {
  const claimPeriodKey = getBattlePassPeriodKey(task.cadence, date);
  if (task.task_type !== 'GREEN_DAY' && task.task_type !== 'GREEN_WEEK') {
    return { claimPeriodKey, activityPeriodKey: claimPeriodKey };
  }
  const activityStart = new Date(`${claimPeriodKey}T00:00:00.000Z`);
  activityStart.setUTCDate(activityStart.getUTCDate() - (task.task_type === 'GREEN_DAY' ? 1 : 7));
  const activityPeriodKey = activityStart.toISOString().slice(0, 10);
  return { claimPeriodKey, activityPeriodKey };
}

function getBattlePassTaskEligibility(task, wallet, periodKey, callback) {
  if (task.task_type === 'SOCIAL_CLICK') return callback(null, true);
  const periodEnd = getBattlePassPeriodEnd(task.cadence, periodKey);
  if (task.task_type === 'GREEN_DAY' || task.task_type === 'GREEN_WEEK') {
    const startComparison = task.task_type === 'GREEN_DAY' ? '= ?' : '>= ? AND d.day < ?';
    const params = task.task_type === 'GREEN_DAY'
      ? [wallet, periodKey]
      : [wallet, periodKey, periodEnd];
    return db.get(
      `SELECT COALESCE(SUM(d.profit), 0) AS profit
       FROM daily_account_summaries d
       JOIN accounts a ON a.id = d.account_id
       WHERE LOWER(a.wallet_address) = LOWER(?) AND d.day ${startComparison}`,
      params,
      (err, row) => err
        ? callback(new Error('Unable to verify trading activity for this task.'))
        : callback(null, Number(row?.profit || 0) > 0)
    );
  }
  if (task.task_type === 'WITHDRAWAL') {
    return db.get(
      `SELECT EXISTS(
         SELECT 1 FROM withdrawals w
         WHERE LOWER(w.wallet_address) = LOWER(?) AND w.status = 'PAID'
           AND date(COALESCE(w.paid_at, w.created_at)) >= date(?) AND date(COALESCE(w.paid_at, w.created_at)) < date(?)
         UNION ALL
         SELECT 1 FROM referral_withdrawals rw
         WHERE LOWER(rw.wallet_address) = LOWER(?) AND rw.status = 'PAID'
           AND date(COALESCE(rw.paid_at, rw.created_at)) >= date(?) AND date(COALESCE(rw.paid_at, rw.created_at)) < date(?)
       ) AS eligible`,
      [wallet, periodKey, periodEnd, wallet, periodKey, periodEnd],
      (err, row) => err
        ? callback(new Error('Unable to verify withdrawal activity for this task.'))
        : callback(null, Number(row?.eligible) === 1)
    );
  }
  if (task.task_type === 'TRADE_DAY') {
    return db.get(
      `SELECT EXISTS(
         SELECT 1 FROM trades t
         JOIN accounts a ON a.id = t.account_id
         WHERE LOWER(a.wallet_address) = LOWER(?) AND t.status = 'CLOSED'
           AND date(t.closed_at) >= date(?) AND date(t.closed_at) < date(?)
       ) AS eligible`,
      [wallet, periodKey, periodEnd],
      (err, row) => err
        ? callback(new Error('Unable to verify trading activity for this task.'))
        : callback(null, Number(row?.eligible) === 1)
    );
  }
  callback(new Error('This battle pass task has an unsupported task type.'));
}

// --- ON-CHAIN SECURE VERIFICATION FUNCTION ---
async function verifyMultiChainPurchase(txHash, chainId, expectedBuyerWallet, expectedAmountUsdt, treasuryWallet) {
    const chainConfig = SUPPORTED_EVM_CHAINS[chainId];
    if (!chainConfig) {
        return { success: false, error: "Unsupported blockchain network." };
    }

    try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!tx || !receipt || receipt.status !== 1) {
            return { success: false, error: "Transaction not found or failed on-chain." };
        }

        // SECURITY CHECK: Mempool Snipe Protection (tx.from must match buyer)
        if (tx.from.toLowerCase() !== expectedBuyerWallet.toLowerCase()) {
            return { success: false, error: "Security Alert: Transaction sender does not match connected wallet." };
        }

        // Verify ERC-20 Transfer Event logs
        const transferTopic = ethers.id("Transfer(address,address,uint256)");
        let validTransfer = false;

        for (const log of receipt.logs) {
            if (log.address.toLowerCase() === chainConfig.usdtAddress.toLowerCase() && log.topics[0] === transferTopic) {
                const recipient = ethers.getAddress('0x' + log.topics[2].slice(26));
                const rawValue = BigInt(log.data);
                const expectedRawValue = ethers.parseUnits(Number(expectedAmountUsdt).toFixed(2), chainConfig.decimals);

                if (recipient.toLowerCase() === treasuryWallet.toLowerCase() && rawValue >= expectedRawValue) {
                    validTransfer = true;
                    break;
                }
            }
        }

        if (!validTransfer) {
            return { success: false, error: "Transaction logs do not show a valid USDT transfer to the treasury." };
        }

        return { success: true };
    } catch (err) {
        console.error("Multi-chain verification error:", err);
        return { success: false, error: "On-chain verification lookup failed." };
    }
}

// --- API ROUTES ---

app.post('/api/auth/trade-challenge', sensitiveLimiter, (req, res) => {
  const wallet = req.body?.wallet_address;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return res.status(400).json({ error: 'A valid wallet address is required.' });
  }

  const key = wallet.toLowerCase();
  const now = Date.now();
  for (const [challengeWallet, challenge] of tradeChallenges) {
    if (challenge.expiresAt <= now) tradeChallenges.delete(challengeWallet);
  }
  if (tradeChallenges.size >= 5000) {
    return res.status(503).json({ error: 'Wallet authorization is temporarily unavailable.' });
  }

  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = now + 2 * 60 * 1000;
  const message = `Blastrr trade authorization\nWallet: ${key}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
  tradeChallenges.set(message, { message, walletAddress: key, expiresAt });
  res.json({ challenge: message });
});

app.post('/api/auth/wallet-session', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const now = Date.now();
  for (const [token, session] of walletSessions) {
    if (session.expiresAt <= now) walletSessions.delete(token);
  }
  if (walletSessions.size >= 5000) {
    return res.status(503).json({ error: 'Wallet sessions are temporarily unavailable.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + WALLET_SESSION_DURATION_MS;
  walletSessions.set(token, { walletAddress: req.body.wallet_address.toLowerCase(), expiresAt });
  res.json({ token, expires_at: expiresAt });
});

app.get('/api/plans', (req, res) => {
  db.get('SELECT standard_discount_pct FROM battlepass_settings WHERE id = 1', [], (settingsErr, settings) => {
    if (settingsErr) return res.status(500).json({ error: 'Unable to load current purchase discounts.' });
    const discountPct = Number(settings?.standard_discount_pct ?? 90);
    db.all("SELECT * FROM plans WHERE active = 1 ORDER BY id", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        plans: rows,
        standard_discount_pct: discountPct
      });
    });
  });
});

app.post('/api/admin/battlepass/load', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.get('SELECT standard_discount_pct FROM battlepass_settings WHERE id = 1', [], (settingsErr, settings) => {
    if (settingsErr || !settings) return res.status(500).json({ error: 'Unable to load battle pass settings.' });
    db.all('SELECT level, xp_required, discount_bonus_pct, points_cost FROM battlepass_levels ORDER BY level', [], (levelsErr, levels) => {
      if (levelsErr) return res.status(500).json({ error: 'Unable to load battle pass levels.' });
      db.all(
        `SELECT p.id AS plan_id, p.name, p.simulated_capital,
                COALESCE(r.xp_reward, 1000) AS xp_reward,
                COALESCE(r.points_reward, 100) AS points_reward
         FROM plans p LEFT JOIN battlepass_plan_rewards r ON r.plan_id = p.id
         WHERE p.active = 1 ORDER BY p.id`,
        [],
        (plansErr, plans) => {
          if (plansErr) return res.status(500).json({ error: 'Unable to load plan battle pass rewards.' });
          db.all('SELECT * FROM battlepass_tasks ORDER BY active DESC, cadence, id', [], (tasksErr, tasks) => {
            if (tasksErr) return res.status(500).json({ error: 'Unable to load battle pass tasks.' });
            res.json({ settings, levels: levels || [], plans: plans || [], tasks: tasks || [] });
          });
        }
      );
    });
  });
});

app.get('/api/battlepass', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested battle pass.' });
  }
  db.run(
    'INSERT OR IGNORE INTO battlepass_users (wallet_address) VALUES (?)',
    [req.walletAddress],
    (insertErr) => {
      if (insertErr) return res.status(500).json({ error: 'Unable to prepare your battle pass profile.' });
      db.get(
        `SELECT b.wallet_address, b.xp, b.points, b.profile_image_url, u.username
         FROM battlepass_users b LEFT JOIN users u ON LOWER(u.wallet_address) = LOWER(b.wallet_address)
         WHERE LOWER(b.wallet_address) = LOWER(?)`,
        [req.walletAddress],
        (profileErr, profile) => {
          if (profileErr || !profile) return res.status(500).json({ error: 'Unable to load your battle pass profile.' });
          const currentLevel = getBattlePassLevel(profile.xp);
          db.all('SELECT * FROM battlepass_levels ORDER BY level', [], (levelsErr, levels) => {
            if (levelsErr) return res.status(500).json({ error: 'Unable to load battle pass levels.' });
            db.all(
              'SELECT level, code, discount_bonus_pct, redeemed_at FROM battlepass_reward_codes WHERE LOWER(wallet_address) = LOWER(?)',
              [req.walletAddress],
              (rewardsErr, rewards) => {
              if (rewardsErr) return res.status(500).json({ error: 'Unable to load your battle pass rewards.' });
              const rewardByLevel = new Map((rewards || []).map(reward => [Number(reward.level), reward]));
              db.all(
                `SELECT t.*,
                        (SELECT c.period_key FROM battlepass_task_claims c
                         WHERE c.task_id = t.id AND LOWER(c.wallet_address) = LOWER(?)
                           AND c.cadence = t.cadence
                         ORDER BY c.created_at DESC LIMIT 1) AS last_period_key
                 FROM battlepass_tasks t WHERE t.active = 1
                 ORDER BY CASE t.cadence WHEN 'DAILY' THEN 1 WHEN 'WEEKLY' THEN 2 ELSE 3 END, t.id`,
                [req.walletAddress],
                (tasksErr, tasks) => {
                  if (tasksErr) return res.status(500).json({ error: 'Unable to load battle pass tasks.' });
                  for (const task of tasks || []) {
                    const taskPeriod = getBattlePassTaskPeriod(task);
                    task.claimed = task.last_period_key === taskPeriod.claimPeriodKey;
                    delete task.last_period_key;
                  }
                  const eligibleTasks = tasks || [];
                  let taskIndex = 0;
                  const checkTaskEligibility = () => {
                    if (taskIndex >= eligibleTasks.length) {
                      return res.json({
                        profile: {
                          ...profile,
                          xp: Number(profile.xp),
                          points: Number(profile.points),
                          level: currentLevel
                        },
                        levels: (levels || []).map(level => ({
                          ...level,
                          reward_code: rewardByLevel.get(Number(level.level))?.code || null,
                          reward_redeemed: Boolean(rewardByLevel.get(Number(level.level))?.redeemed_at),
                          unlocked: currentLevel >= Number(level.level)
                        })),
                        tasks: eligibleTasks
                      });
                    }
                    const task = eligibleTasks[taskIndex++];
                    const period = getBattlePassTaskPeriod(task);
                    if (task.claimed) {
                      task.eligible = false;
                      return checkTaskEligibility();
                    }
                    getBattlePassTaskEligibility(task, req.walletAddress, period.activityPeriodKey, (eligibilityErr, eligible) => {
                      if (eligibilityErr) return res.status(500).json({ error: eligibilityErr.message });
                      task.eligible = eligible;
                      checkTaskEligibility();
                    });
                  };
                  checkTaskEligibility();
                }
              );
            });
          });
        }
      );
    }
  );
});

app.get('/api/battlepass/profile', (req, res) => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!/^[a-z0-9_]{3,24}$/i.test(username)) {
    return res.status(400).json({ error: 'A valid battle pass username is required.' });
  }
  db.get(
    `SELECT u.username, b.xp, b.profile_image_url
     FROM users u LEFT JOIN battlepass_users b ON LOWER(b.wallet_address) = LOWER(u.wallet_address)
     WHERE LOWER(u.username) = LOWER(?)`,
    [username],
    (err, profile) => {
      if (err) return res.status(500).json({ error: 'Unable to load this public battle pass profile.' });
      if (!profile) return res.status(404).json({ error: 'Battle pass profile not found.' });
      const xp = Number(profile.xp || 0);
      res.json({
        profile: {
          username: profile.username,
          xp,
            level: getBattlePassLevel(xp),
            profile_image_url: profile.profile_image_url
          }
      });
    }
  );
});

app.post('/api/battlepass/profile', sensitiveLimiter, requireWalletSession, (req, res) => {
  const imageUrl = typeof req.body?.profile_image_url === 'string' ? req.body.profile_image_url.trim() : '';
  if (imageUrl.length > 2048) return res.status(400).json({ error: 'Profile image URL must be 2,048 characters or fewer.' });
  if (imageUrl) {
    try {
      const parsed = new URL(imageUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported profile image URL scheme.');
    } catch {
      return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS profile image URL.' });
    }
  }
  db.run(
    `INSERT INTO battlepass_users (wallet_address, profile_image_url)
     VALUES (?, ?)
     ON CONFLICT(wallet_address) DO UPDATE SET profile_image_url = excluded.profile_image_url,
       updated_at = CURRENT_TIMESTAMP`,
    [req.walletAddress, imageUrl || null],
    (err) => {
      if (err) return res.status(500).json({ error: 'Unable to update your battle pass profile.' });
      res.json({ success: true, profile_image_url: imageUrl || null });
    }
  );
});

app.post('/api/battlepass/tasks/claim', sensitiveLimiter, requireWalletSession, (req, res) => {
  const taskId = Number(req.body?.task_id);
  if (!Number.isInteger(taskId) || taskId <= 0) return res.status(400).json({ error: 'Choose a valid battle pass task.' });
  db.get('SELECT id, task_type, cadence, xp_reward, points_reward FROM battlepass_tasks WHERE id = ? AND active = 1', [taskId], (taskErr, task) => {
    if (taskErr) return res.status(500).json({ error: 'Unable to load this battle pass task.' });
    if (!task) return res.status(404).json({ error: 'This battle pass task is no longer available.' });
    if ((task.task_type === 'GREEN_DAY' && task.cadence !== 'DAILY') ||
        (task.task_type === 'GREEN_WEEK' && task.cadence !== 'WEEKLY')) {
      return res.status(409).json({ error: 'This task has an invalid completion schedule.' });
    }
    const taskPeriod = getBattlePassTaskPeriod(task);
    const periodKey = taskPeriod.claimPeriodKey;
    getBattlePassTaskEligibility(task, req.walletAddress, taskPeriod.activityPeriodKey, (eligibilityErr, eligible) => {
      if (eligibilityErr) return res.status(500).json({ error: eligibilityErr.message });
      if (!eligible) return res.status(409).json({ error: 'This task reward is not available yet.' });
    const claimId = `bpt_${crypto.randomBytes(10).toString('hex')}`;
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return res.status(500).json({ error: 'Unable to start task reward.' });
        const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
        db.run(
          `INSERT INTO battlepass_task_claims (id, wallet_address, task_id, cadence, period_key)
           VALUES (?, ?, ?, ?, ?)`,
          [claimId, req.walletAddress, task.id, task.cadence, periodKey],
          (claimErr) => {
            if (claimErr) {
              if (claimErr.code === 'SQLITE_CONSTRAINT') return rollback(409, 'You have already earned this task reward for the current period.');
              return rollback(500, 'Unable to record this task reward.');
            }
            db.run('INSERT OR IGNORE INTO battlepass_users (wallet_address) VALUES (?)', [req.walletAddress], (userErr) => {
              if (userErr) return rollback(500, 'Unable to load your battle pass balance.');
              db.run(
                `UPDATE battlepass_users SET xp = xp + ?, points = points + ?, updated_at = CURRENT_TIMESTAMP
                 WHERE LOWER(wallet_address) = LOWER(?)`,
                [task.xp_reward, task.points_reward, req.walletAddress],
                (balanceErr) => {
                  if (balanceErr) return rollback(500, 'Unable to add your task reward.');
                  db.run(
                    `INSERT INTO battlepass_events (id, wallet_address, event_type, reference_id, xp, points)
                     VALUES (?, ?, 'TASK', ?, ?, ?)`,
                    [`bpe_${crypto.randomBytes(10).toString('hex')}`, req.walletAddress, `${req.walletAddress}:${task.id}:${periodKey}`, task.xp_reward, task.points_reward],
                    (eventErr) => {
                      if (eventErr) return rollback(500, 'Unable to record your task reward history.');
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) return rollback(500, 'Unable to complete task reward.');
                        res.json({
                          success: true,
                          xp_awarded: task.xp_reward,
                          points_awarded: task.points_reward,
                          period_key: periodKey
                        });
                      });
                    }
                  );
                }
              );
            });
          }
        );
      });
    });
    });
  });
});

app.post('/api/battlepass/rewards/claim', sensitiveLimiter, requireWalletSession, (req, res) => {
  const level = Number(req.body?.level);
  if (!Number.isInteger(level) || level < 1 || level > 12) {
    return res.status(400).json({ error: 'Choose a valid battle pass level reward.' });
  }
  db.get('SELECT xp, points FROM battlepass_users WHERE LOWER(wallet_address) = LOWER(?)', [req.walletAddress], (userErr, user) => {
    if (userErr) return res.status(500).json({ error: 'Unable to load your battle pass balance.' });
    if (!user) return res.status(404).json({ error: 'Battle pass profile not found.' });
    if (getBattlePassLevel(user.xp) < level) return res.status(403).json({ error: 'Earn more XP to unlock this level reward.' });
    db.get('SELECT * FROM battlepass_levels WHERE level = ?', [level], (levelErr, reward) => {
      if (levelErr) return res.status(500).json({ error: 'Unable to load this level reward.' });
      if (!reward) return res.status(404).json({ error: 'Battle pass level not found.' });
      if (Number(user.points) < Number(reward.points_cost)) {
        return res.status(400).json({ error: `You need ${reward.points_cost} points to claim this level reward.` });
      }
      const code = `PASS-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginErr) => {
          if (beginErr) return res.status(500).json({ error: 'Unable to start level reward claim.' });
          const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
          db.run(
            `INSERT INTO battlepass_reward_codes (code, wallet_address, level, discount_bonus_pct)
             VALUES (?, ?, ?, ?)`,
            [code, req.walletAddress, level, reward.discount_bonus_pct],
            (insertErr) => {
              if (insertErr) {
                if (insertErr.code === 'SQLITE_CONSTRAINT') return rollback(409, 'This level reward has already been claimed.');
                return rollback(500, 'Unable to create your level discount code.');
              }
              db.run(
                `UPDATE battlepass_users SET points = points - ?, updated_at = CURRENT_TIMESTAMP
                 WHERE LOWER(wallet_address) = LOWER(?) AND points >= ?`,
                [reward.points_cost, req.walletAddress, reward.points_cost],
                function(updateErr) {
                  if (updateErr) return rollback(500, 'Unable to deduct reward points.');
                  if (this.changes !== 1) return rollback(409, 'Your points changed; refresh and try again.');
                  db.run(
                    `INSERT INTO battlepass_events (id, wallet_address, event_type, reference_id, xp, points)
                     VALUES (?, ?, 'LEVEL_REWARD', ?, 0, ?)`,
                    [`bpe_${crypto.randomBytes(10).toString('hex')}`, req.walletAddress, `${req.walletAddress}:level:${level}`, -Number(reward.points_cost)],
                    (eventErr) => {
                      if (eventErr) return rollback(500, 'Unable to record your level reward claim.');
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) return rollback(500, 'Unable to complete level reward claim.');
                        res.json({ success: true, code, discount_bonus_pct: Number(reward.discount_bonus_pct) });
                      });
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });
});

app.get('/api/auth/role', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.json({ isAdmin: false });

  db.get("SELECT * FROM admins WHERE LOWER(wallet_address) = LOWER(?)", [wallet], (err, admin) => {
    res.json({ isAdmin: !!admin });
  });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode || 'DAILY';
  let query = '';

  if (mode === 'DAILY') {
    query = `
      SELECT u.username, u.discount_code, u.wallet_address, b.profile_image_url, COALESCE(b.xp, 0) AS battlepass_xp, SUM(t.pnl) as metric_value
      FROM users u
      LEFT JOIN battlepass_users b ON LOWER(b.wallet_address) = LOWER(u.wallet_address)
      JOIN accounts a ON LOWER(u.wallet_address) = LOWER(a.wallet_address)
      JOIN trades t ON a.id = t.account_id
      WHERE t.status = 'CLOSED' AND u.username IS NOT NULL AND strftime('%Y-%m-%d', t.closed_at) = strftime('%Y-%m-%d', 'now')
      GROUP BY u.wallet_address
      ORDER BY metric_value DESC
      LIMIT 100;
    `;
  } else if (mode === 'MONTHLY') {
    query = `
      SELECT u.username, u.discount_code, u.wallet_address, b.profile_image_url, COALESCE(b.xp, 0) AS battlepass_xp, SUM(t.pnl) as metric_value
      FROM users u
      LEFT JOIN battlepass_users b ON LOWER(b.wallet_address) = LOWER(u.wallet_address)
      JOIN accounts a ON LOWER(u.wallet_address) = LOWER(a.wallet_address)
      JOIN trades t ON a.id = t.account_id
      WHERE t.status = 'CLOSED' AND u.username IS NOT NULL AND strftime('%Y-%m', t.closed_at) = strftime('%Y-%m', 'now')
      GROUP BY u.wallet_address
      ORDER BY metric_value DESC
      LIMIT 100;
    `;
  } else if (mode === 'PAYOUTS') {
    query = `
      SELECT u.username, u.discount_code, u.wallet_address, b.profile_image_url, COALESCE(b.xp, 0) AS battlepass_xp, SUM(w.amount) as metric_value
      FROM users u
      LEFT JOIN battlepass_users b ON LOWER(b.wallet_address) = LOWER(u.wallet_address)
      JOIN (
        SELECT wallet_address, amount FROM withdrawals WHERE status = 'PAID'
        UNION ALL
        SELECT wallet_address, amount FROM referral_withdrawals WHERE status = 'PAID'
      ) w ON LOWER(u.wallet_address) = LOWER(w.wallet_address)
      WHERE u.username IS NOT NULL
      GROUP BY u.wallet_address
      ORDER BY metric_value DESC
      LIMIT 100;
    `;
  } else {
    return res.status(400).json({ error: "Invalid leaderboard mode" });
  }

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ leaderboard: rows || [], mode });
  });
});

app.get('/api/user/profile', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested profile.' });
  }

  db.get("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)", [wallet], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    
    db.all(
      `SELECT COUNT(id) as total_referrals, SUM(commission_earned) as total_earned 
       FROM referrals WHERE LOWER(referrer_wallet) = LOWER(?)`, 
      [wallet], 
      (err2, stats) => {
        db.all(
          `SELECT SUM(amount) as total_withdrawn FROM referral_withdrawals WHERE LOWER(wallet_address) = LOWER(?) AND status != 'REJECTED'`,
          [wallet],
          (err3, wdrStats) => {
            const totalEarned = stats[0]?.total_earned || 0;
            const totalWithdrawn = wdrStats[0]?.total_withdrawn || 0;
            res.json({
              user: user || null,
              stats: {
                total_referrals: stats[0]?.total_referrals || 0,
                total_earned: totalEarned,
                available_commission: Math.max(0, totalEarned - totalWithdrawn)
              }
            });
          }
        );
      }
    );
  });
});

app.post('/api/user/profile', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { wallet_address, username, discount_code } = req.body;
  if (typeof username !== 'string' || typeof discount_code !== 'string') {
    return res.status(400).json({ error: "Username and promo code are required." });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanCode = discount_code.trim().toUpperCase();
  if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername) || !/^[A-Z0-9_-]{4,20}$/.test(cleanCode)) {
    return res.status(400).json({ error: "Username must be 3-24 letters, numbers, or underscores; promo codes must be 4-20 letters, numbers, underscores, or hyphens." });
  }

  db.get(
    `SELECT * FROM users WHERE (LOWER(username) = ? OR UPPER(discount_code) = ?) AND LOWER(wallet_address) != LOWER(?)`,
    [cleanUsername, cleanCode, wallet_address],
    (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) {
        if (existing.username.toLowerCase() === cleanUsername) {
          return res.status(400).json({ error: "Username is already taken by another user." });
        }
        return res.status(400).json({ error: "Promo Code is already taken by another user." });
      }

      db.run(
        `INSERT INTO users (wallet_address, username, discount_code) 
         VALUES (?, ?, ?)
         ON CONFLICT(wallet_address) DO UPDATE SET 
         username = excluded.username, 
         discount_code = excluded.discount_code`,
        [wallet_address, cleanUsername, cleanCode],
        (err2) => {
          if (err2) return res.status(400).json({ error: "Failed to update profile." });
          res.json({ success: true, message: "Profile updated successfully." });
        }
      );
    }
  );
});

app.post('/api/promo/claim', sensitiveLimiter, requireWalletSession, (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  if (!/^FREE-[A-F0-9]{20}$/.test(code)) {
    return res.status(400).json({ error: 'Enter a valid free account code.' });
  }

  const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return res.status(500).json({ error: 'Unable to start code redemption.' });
      db.get(
        `SELECT c.plan_id, c.claimed_by, c.claimed_at, p.name AS plan_name,
                p.simulated_capital
         FROM promo_codes c JOIN plans p ON p.id = c.plan_id
         WHERE c.code = ?`,
        [code],
        (codeErr, promo) => {
          if (codeErr) return rollback(500, 'Unable to check this free account code.');
          if (!promo) return rollback(404, 'Free account code not found.');
          if (promo.claimed_at || promo.claimed_by) return rollback(409, 'This free account code has already been claimed.');

          db.get(
            'SELECT wallet_address FROM users WHERE LOWER(wallet_address) = LOWER(?)',
            [req.walletAddress],
            (userErr, user) => {
              if (userErr) return rollback(500, 'Unable to prepare your account.');
              const walletAddress = user?.wallet_address || req.walletAddress;
              const createAccount = () => {
                const accountId = `acc_${crypto.randomBytes(8).toString('hex')}`;
                db.run(
                  `UPDATE promo_codes SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP
                   WHERE code = ? AND claimed_at IS NULL AND claimed_by IS NULL`,
                  [walletAddress, code],
                  function(claimErr) {
                    if (claimErr) return rollback(500, 'Unable to claim this free account code.');
                    if (this.changes !== 1) return rollback(409, 'This free account code has already been claimed.');
                    db.run(
                      `INSERT INTO accounts (id, wallet_address, plan_id, initial_balance, current_balance,
                         current_equity, high_water_mark, daily_starting_balance, risk_day, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                      [
                        accountId, walletAddress, promo.plan_id, promo.simulated_capital,
                        promo.simulated_capital, promo.simulated_capital, promo.simulated_capital,
                        promo.simulated_capital, new Date().toISOString().slice(0, 10)
                      ],
                      (accountErr) => {
                        if (accountErr) return rollback(500, 'Unable to provision the free account.');
                        db.run('COMMIT', (commitErr) => {
                          if (commitErr) return rollback(500, 'Unable to commit free account provisioning.');
                          res.json({
                            success: true,
                            account_id: accountId,
                            plan_name: promo.plan_name,
                            message: 'Free account provisioned successfully.'
                          });
                        });
                      }
                    );
                  }
                );
              };

              if (user) return createAccount();
              db.run(
                'INSERT INTO users (wallet_address) VALUES (?)',
                [walletAddress],
                (insertUserErr) => {
                  if (insertUserErr) return rollback(500, 'Unable to prepare your account.');
                  createAccount();
                }
              );
            }
          );
        }
      );
    });
  });
});

function attachTicketMessages(tickets, callback) {
  if (!tickets.length) return callback(null, tickets);
  const ids = tickets.map(ticket => ticket.id);
  const placeholders = ids.map(() => '?').join(',');
  db.all(
    `SELECT id, ticket_id, author_role, author_name, body, created_at
     FROM support_ticket_messages WHERE ticket_id IN (${placeholders})
     ORDER BY created_at, id`,
    ids,
    (err, messages) => {
      if (err) return callback(err);
      const grouped = new Map(tickets.map(ticket => [ticket.id, []]));
      for (const message of messages || []) grouped.get(message.ticket_id)?.push(message);
      for (const ticket of tickets) ticket.messages = grouped.get(ticket.id) || [];
      callback(null, tickets);
    }
  );
}

app.get('/api/user/tickets', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested support tickets.' });
  }
  db.all(
    `SELECT t.*, p.name AS plan_name
     FROM support_tickets t
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN plans p ON p.id = a.plan_id
     WHERE LOWER(t.wallet_address) = LOWER(?)
     ORDER BY t.updated_at DESC, t.created_at DESC LIMIT 100`,
    [wallet],
    (err, tickets) => {
      if (err) return res.status(500).json({ error: 'Unable to load support tickets.' });
      attachTicketMessages(tickets || [], (messagesErr, results) => {
        if (messagesErr) return res.status(500).json({ error: 'Unable to load ticket replies.' });
        res.json({ tickets: results });
      });
    }
  );
});

app.post('/api/user/tickets', sensitiveLimiter, requireWalletSession, (req, res) => {
  const accountId = typeof req.body?.account_id === 'string' && req.body.account_id ? req.body.account_id : null;
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (subject.length < 5 || subject.length > 120 || message.length < 10 || message.length > 5000) {
    return res.status(400).json({ error: 'Enter a subject (5–120 characters) and issue details (10–5,000 characters).' });
  }

  const createTicket = (username) => {
    const ticketId = `ticket_${crypto.randomBytes(8).toString('hex')}`;
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return res.status(500).json({ error: 'Unable to start support ticket.' });
        const rollback = (error) => db.run('ROLLBACK', () => res.status(500).json({ error }));
        db.run(
          `INSERT INTO support_tickets (id, wallet_address, account_id, subject, status)
           VALUES (?, ?, ?, ?, 'OPEN')`,
          [ticketId, req.walletAddress, accountId, subject],
          (ticketErr) => {
            if (ticketErr) return rollback('Unable to create support ticket.');
            db.run(
              `INSERT INTO support_ticket_messages (ticket_id, author_role, author_name, body)
               VALUES (?, 'USER', ?, ?)`,
              [ticketId, username || `${req.walletAddress.slice(0, 6)}…${req.walletAddress.slice(-4)}`, message],
              (messageErr) => {
                if (messageErr) return rollback('Unable to save the initial ticket message.');
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return rollback('Unable to commit support ticket.');
                  res.status(201).json({ success: true, ticket_id: ticketId });
                });
              }
            );
          }
        );
      });
    });
  };

  const verifyAccount = (done) => {
    if (!accountId) return done(null, null);
    db.get(
      `SELECT id FROM accounts WHERE id = ? AND LOWER(wallet_address) = LOWER(?)`,
      [accountId, req.walletAddress],
      (err, account) => {
        if (err) return res.status(500).json({ error: 'Unable to verify the selected account.' });
        if (!account) return res.status(403).json({ error: 'The selected account does not belong to this wallet.' });
        done(null, account);
      }
    );
  };
  verifyAccount(() => {
    db.get('SELECT username FROM users WHERE LOWER(wallet_address) = LOWER(?)', [req.walletAddress], (userErr, user) => {
      if (userErr) return res.status(500).json({ error: 'Unable to load profile for support ticket.' });
      createTicket(user?.username);
    });
  });
});

app.post('/api/user/tickets/:ticketId/reply', sensitiveLimiter, requireWalletSession, (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 1 || message.length > 5000) {
    return res.status(400).json({ error: 'Ticket replies must be between 1 and 5,000 characters.' });
  }
  db.get(
    `SELECT t.id, t.status, u.username FROM support_tickets t
     LEFT JOIN users u ON LOWER(u.wallet_address) = LOWER(t.wallet_address)
     WHERE t.id = ? AND LOWER(t.wallet_address) = LOWER(?)`,
    [req.params.ticketId, req.walletAddress],
    (err, ticket) => {
      if (err) return res.status(500).json({ error: 'Unable to load support ticket.' });
      if (!ticket) return res.status(404).json({ error: 'Support ticket not found.' });
      if (ticket.status === 'CLOSED') return res.status(409).json({ error: 'Closed tickets cannot be replied to.' });
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginErr) => {
          if (beginErr) return res.status(500).json({ error: 'Unable to start ticket reply.' });
          const rollback = (error) => db.run('ROLLBACK', () => res.status(500).json({ error }));
          db.run(
            `INSERT INTO support_ticket_messages (ticket_id, author_role, author_name, body)
             VALUES (?, 'USER', ?, ?)`,
            [ticket.id, ticket.username || `${req.walletAddress.slice(0, 6)}…${req.walletAddress.slice(-4)}`, message],
            (insertErr) => {
              if (insertErr) return rollback('Unable to save ticket reply.');
              db.run(
                `UPDATE support_tickets SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND status != 'CLOSED'`,
                [ticket.id],
                function(updateErr) {
                  if (updateErr) return rollback('Unable to update ticket status.');
                  if (this.changes !== 1) {
                    return db.run('ROLLBACK', () => res.status(409).json({ error: 'Closed tickets cannot be replied to.' }));
                  }
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) return rollback('Unable to commit ticket reply.');
                    res.json({ success: true, status: 'OPEN' });
                  });
                }
              );
            }
          );
        });
      });
    }
  );
});

app.get('/api/user/review', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested review.' });
  }
  db.all(
    `SELECT a.id AS account_id, a.created_at AS account_created_at, p.name AS plan_name,
            r.username, r.rating, r.comment, r.published, r.created_at, r.updated_at
     FROM accounts a
    LEFT JOIN plans p ON p.id = a.plan_id
    LEFT JOIN user_reviews r ON r.account_id = a.id AND LOWER(r.wallet_address) = LOWER(a.wallet_address)
    WHERE LOWER(a.wallet_address) = LOWER(?)
      AND EXISTS (SELECT 1 FROM purchases purchase
                  WHERE purchase.account_id = a.id
                    AND LOWER(purchase.wallet_address) = LOWER(a.wallet_address))
    ORDER BY a.created_at, a.id`,
    [wallet],
    (err, accounts) => {
      if (err) return res.status(500).json({ error: 'Unable to load your eligible review accounts.' });
      res.json({ accounts: accounts || [] });
    }
  );
});

app.post('/api/user/reviews', sensitiveLimiter, requireWalletSession, (req, res) => {
  const accountId = typeof req.body?.account_id === 'string' ? req.body.account_id.trim() : '';
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
  if (!accountId || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 10 || comment.length > 1500) {
    return res.status(400).json({ error: 'Select a purchased account, choose 1–5 stars, and enter a review between 10 and 1,500 characters.' });
  }
  db.get('SELECT username FROM users WHERE LOWER(wallet_address) = LOWER(?)', [req.walletAddress], (err, user) => {
    if (err) return res.status(500).json({ error: 'Unable to load your profile.' });
    if (!user?.username) return res.status(400).json({ error: 'Create a profile username before submitting a review.' });
    db.get(
      `SELECT a.id FROM accounts a
       WHERE a.id = ? AND LOWER(a.wallet_address) = LOWER(?)
         AND EXISTS (SELECT 1 FROM purchases purchase
                     WHERE purchase.account_id = a.id
                       AND LOWER(purchase.wallet_address) = LOWER(a.wallet_address))`,
      [accountId, req.walletAddress],
      (accountErr, account) => {
        if (accountErr) return res.status(500).json({ error: 'Unable to verify purchased account eligibility.' });
        if (!account) return res.status(403).json({ error: 'Reviews are available only for accounts purchased by this wallet.' });
        db.run(
          `INSERT INTO user_reviews (account_id, wallet_address, username, rating, comment, published)
           VALUES (?, ?, ?, ?, ?, 0)
           ON CONFLICT(account_id) DO UPDATE SET username = excluded.username,
             rating = excluded.rating, comment = excluded.comment, published = 0,
             updated_at = CURRENT_TIMESTAMP
           WHERE LOWER(user_reviews.wallet_address) = LOWER(excluded.wallet_address)`,
          [accountId, req.walletAddress, user.username, rating, comment],
          function(saveErr) {
            if (saveErr) return res.status(500).json({ error: 'Unable to save your review.' });
            if (this.changes !== 1) return res.status(403).json({ error: 'This account review belongs to another wallet.' });
            res.json({ success: true, message: 'Review saved and sent to the admin team for review.' });
          }
        );
      }
    );
  });
});

app.get('/api/reviews', (req, res) => {
  db.all(
    `SELECT username, rating, comment, updated_at
     FROM user_reviews WHERE published = 1
     ORDER BY updated_at DESC LIMIT 12`,
    [],
    (err, reviews) => {
      if (err) return res.status(500).json({ error: 'Unable to load published reviews.' });
      res.json({ reviews: reviews || [] });
    }
  );
});

app.post('/api/admin/tickets', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT t.*, u.username, a.plan_id, p.name AS plan_name
     FROM support_tickets t
     LEFT JOIN users u ON LOWER(u.wallet_address) = LOWER(t.wallet_address)
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN plans p ON p.id = a.plan_id
     ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'NEEDS_INFO' THEN 1 ELSE 2 END,
       t.updated_at DESC LIMIT 250`,
    [],
    (err, tickets) => {
      if (err) return res.status(500).json({ error: 'Unable to load support tickets.' });
      attachTicketMessages(tickets || [], (messagesErr, results) => {
        if (messagesErr) return res.status(500).json({ error: 'Unable to load ticket replies.' });
        res.json({ tickets: results });
      });
    }
  );
});

app.post('/api/admin/tickets/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const ticketId = typeof req.body?.ticket_id === 'string' ? req.body.ticket_id : '';
  const action = req.body?.action;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!ticketId || !['REPLY', 'CLOSE'].includes(action) ||
      (action === 'REPLY' && (message.length < 1 || message.length > 5000)) ||
      (action === 'CLOSE' && message.length > 5000)) {
    return res.status(400).json({ error: 'A ticket, valid action, and reply within 5,000 characters are required.' });
  }
  db.get('SELECT id, status FROM support_tickets WHERE id = ?', [ticketId], (err, ticket) => {
    if (err) return res.status(500).json({ error: 'Unable to load support ticket.' });
    if (!ticket) return res.status(404).json({ error: 'Support ticket not found.' });
    if (ticket.status === 'CLOSED') return res.status(409).json({ error: 'This ticket is already closed.' });
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return res.status(500).json({ error: 'Unable to start ticket update.' });
        const rollback = (error) => db.run('ROLLBACK', () => res.status(500).json({ error }));
        const updateStatus = () => db.run(
          `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'CLOSED'`,
          [action === 'CLOSE' ? 'CLOSED' : 'NEEDS_INFO', ticket.id],
          function(updateErr) {
            if (updateErr) return rollback('Unable to update ticket status.');
            if (this.changes !== 1) {
              return db.run('ROLLBACK', () => res.status(409).json({ error: 'This ticket is already closed.' }));
            }
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return rollback('Unable to commit ticket update.');
              res.json({ success: true, status: action === 'CLOSE' ? 'CLOSED' : 'NEEDS_INFO' });
            });
          }
        );
        if (!message) return updateStatus();
        db.run(
          `INSERT INTO support_ticket_messages (ticket_id, author_role, author_name, body)
           VALUES (?, 'ADMIN', 'Blastrr Support', ?)`,
          [ticket.id, message],
          (insertErr) => insertErr ? rollback('Unable to save admin reply.') : updateStatus()
        );
      });
    });
  });
});

app.post('/api/admin/reviews', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT r.account_id, r.wallet_address, r.username, r.rating, r.comment, r.published, r.created_at, r.updated_at,
            p.name AS plan_name
     FROM user_reviews r
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN plans p ON p.id = a.plan_id
     ORDER BY r.published ASC, r.updated_at DESC LIMIT 300`,
    [],
    (err, reviews) => {
      if (err) return res.status(500).json({ error: 'Unable to load user reviews.' });
      res.json({ reviews: reviews || [] });
    }
  );
});

app.post('/api/admin/reviews/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const accountId = req.body?.review_account_id;
  const action = req.body?.action;
  if (typeof accountId !== 'string' || !accountId.trim() || !['PUBLISH', 'HIDE'].includes(action)) {
    return res.status(400).json({ error: 'A valid review account and publish or hide action are required.' });
  }
  db.run(
    'UPDATE user_reviews SET published = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?',
    [action === 'PUBLISH' ? 1 : 0, accountId.trim()],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: 'Unable to update review publication.' });
      if (this.changes !== 1) return res.status(404).json({ error: 'Review not found.' });
      res.json({ success: true, published: action === 'PUBLISH' });
    }
  );
});

app.post('/api/admin/referrals/search', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (username.length < 2 || username.length > 24) {
    return res.status(400).json({ error: 'Enter at least 2 characters of a username to search.' });
  }
  db.all(
    `SELECT wallet_address, username, referral_pct
     FROM users
     WHERE username IS NOT NULL AND username LIKE ? COLLATE NOCASE
     ORDER BY username COLLATE NOCASE LIMIT 50`,
    [`%${username}%`],
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Unable to search creator profiles.' });
      res.json({ users: users || [] });
    }
  );
});

app.post('/api/admin/referrals/commission', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const wallet = req.body?.user_wallet;
  const referralPct = Number(req.body?.referral_pct);
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) ||
      !Number.isFinite(referralPct) || referralPct < 0 || referralPct > 100) {
    return res.status(400).json({ error: 'Choose a valid user wallet and a commission rate from 0 to 100%.' });
  }
  const normalizedPct = Math.round(referralPct * 100) / 100;
  db.run(
    'UPDATE users SET referral_pct = ? WHERE LOWER(wallet_address) = LOWER(?) AND username IS NOT NULL',
    [normalizedPct, wallet],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: 'Unable to update the creator commission rate.' });
      if (this.changes !== 1) return res.status(404).json({ error: 'Creator profile not found.' });
      res.json({ success: true, referral_pct: normalizedPct });
    }
  );
});

app.post('/api/admin/promo-codes/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT c.code, c.created_at, c.claimed_by, c.claimed_at, p.name AS plan_name
     FROM promo_codes c JOIN plans p ON p.id = c.plan_id
     ORDER BY c.created_at DESC LIMIT 100`,
    [],
    (err, codes) => {
      if (err) return res.status(500).json({ error: 'Unable to load free account codes.' });
      res.json({ codes: codes || [] });
    }
  );
});

app.post('/api/admin/promo-codes/create', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const planId = Number(req.body?.plan_id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ error: 'Choose an account plan for this code.' });
  }
  db.get('SELECT id, name FROM plans WHERE id = ? AND active = 1', [planId], (planErr, plan) => {
    if (planErr) return res.status(500).json({ error: 'Unable to load the selected account plan.' });
    if (!plan) return res.status(404).json({ error: 'The selected account plan is not available.' });
    const code = `FREE-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    db.run(
      'INSERT INTO promo_codes (code, plan_id, created_by) VALUES (?, ?, ?)',
      [code, plan.id, req.body.wallet_address.toLowerCase()],
      (insertErr) => {
        if (insertErr) return res.status(500).json({ error: 'Unable to generate a free account code.' });
        res.json({ success: true, code, plan_name: plan.name });
      }
    );
  });
});

app.post('/api/admin/battlepass/settings', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const discountPct = Number(req.body?.standard_discount_pct);
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return res.status(400).json({ error: 'The standard discount must be between 0 and 100%.' });
  }
  db.run(
    'UPDATE battlepass_settings SET standard_discount_pct = ? WHERE id = 1',
    [Math.round(discountPct * 100) / 100],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: 'Unable to update the standard discount.' });
      if (this.changes !== 1) return res.status(500).json({ error: 'Battle pass settings are unavailable.' });
      res.json({ success: true, standard_discount_pct: Math.round(discountPct * 100) / 100 });
    }
  );
});

app.post('/api/admin/battlepass/settings/get', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.get('SELECT standard_discount_pct FROM battlepass_settings WHERE id = 1', [], (err, settings) => {
    if (err || !settings) return res.status(500).json({ error: 'Unable to load battle pass settings.' });
    res.json({ settings });
  });
});

app.post('/api/admin/battlepass/levels/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all('SELECT level, xp_required, discount_bonus_pct, points_cost FROM battlepass_levels ORDER BY level', [], (err, levels) => {
    if (err) return res.status(500).json({ error: 'Unable to load battle pass levels.' });
    res.json({ levels: levels || [] });
  });
});

app.post('/api/admin/battlepass/levels/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const level = Number(req.body?.level);
  const discountPct = Number(req.body?.discount_bonus_pct);
  const pointsCost = Number(req.body?.points_cost);
  if (!Number.isInteger(level) || level < 1 || level > 12 ||
      !Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100 ||
      !Number.isSafeInteger(pointsCost) || pointsCost < 0) {
    return res.status(400).json({ error: 'Set a level from 1 to 12, an additional discount from 0 to 100%, and a non-negative point cost.' });
  }
  db.run(
    'UPDATE battlepass_levels SET discount_bonus_pct = ?, points_cost = ? WHERE level = ?',
    [Math.round(discountPct * 100) / 100, pointsCost, level],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: 'Unable to update the level reward.' });
      if (this.changes !== 1) return res.status(404).json({ error: 'Battle pass level not found.' });
      res.json({ success: true });
    }
  );
});

app.post('/api/admin/battlepass/plan-rewards/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT p.id AS plan_id, p.name, p.simulated_capital,
            COALESCE(r.xp_reward, 1000) AS xp_reward,
            COALESCE(r.points_reward, 100) AS points_reward
     FROM plans p LEFT JOIN battlepass_plan_rewards r ON r.plan_id = p.id
     WHERE p.active = 1 ORDER BY p.id`,
    [],
    (err, plans) => {
      if (err) return res.status(500).json({ error: 'Unable to load plan battle pass rewards.' });
      res.json({ plans: plans || [] });
    }
  );
});

app.post('/api/admin/battlepass/plan-rewards/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const planId = Number(req.body?.plan_id);
  const xpReward = Number(req.body?.xp_reward);
  const pointsReward = Number(req.body?.points_reward);
  if (!Number.isInteger(planId) || planId <= 0 ||
      !Number.isSafeInteger(xpReward) || xpReward < 0 ||
      !Number.isSafeInteger(pointsReward) || pointsReward < 0) {
    return res.status(400).json({ error: 'Set a valid plan and non-negative XP and point rewards.' });
  }
  db.get('SELECT id FROM plans WHERE id = ? AND active = 1', [planId], (planErr, plan) => {
    if (planErr) return res.status(500).json({ error: 'Unable to load the selected plan.' });
    if (!plan) return res.status(404).json({ error: 'The selected plan is unavailable.' });
    db.run(
      `INSERT INTO battlepass_plan_rewards (plan_id, xp_reward, points_reward) VALUES (?, ?, ?)
       ON CONFLICT(plan_id) DO UPDATE SET xp_reward = excluded.xp_reward, points_reward = excluded.points_reward`,
      [planId, xpReward, pointsReward],
      (saveErr) => {
        if (saveErr) return res.status(500).json({ error: 'Unable to save plan battle pass rewards.' });
        res.json({ success: true });
      }
    );
  });
});

app.post('/api/admin/battlepass/tasks/list', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all('SELECT * FROM battlepass_tasks ORDER BY active DESC, cadence, id', [], (err, tasks) => {
    if (err) return res.status(500).json({ error: 'Unable to load battle pass tasks.' });
    res.json({ tasks: tasks || [] });
  });
});

app.post('/api/admin/battlepass/tasks/rewards', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const taskId = Number(req.body?.task_id);
  const xpReward = Number(req.body?.xp_reward);
  const pointsReward = Number(req.body?.points_reward);
  if (!Number.isInteger(taskId) || taskId <= 0 ||
      !Number.isSafeInteger(xpReward) || xpReward < 0 ||
      !Number.isSafeInteger(pointsReward) || pointsReward < 0) {
    return res.status(400).json({ error: 'Set valid non-negative XP and point rewards for a built-in task.' });
  }
  db.run(
    'UPDATE battlepass_tasks SET xp_reward = ?, points_reward = ? WHERE id = ? AND is_builtin = 1',
    [xpReward, pointsReward, taskId],
    function(updateErr) {
      if (updateErr) return res.status(500).json({ error: 'Unable to update built-in task rewards.' });
      if (this.changes !== 1) return res.status(404).json({ error: 'Built-in battle pass task not found.' });
      res.json({ success: true });
    }
  );
});

app.post('/api/admin/battlepass/tasks/save', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const taskId = req.body?.task_id == null || req.body?.task_id === '' ? null : Number(req.body.task_id);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
  const actionUrl = typeof req.body?.action_url === 'string' ? req.body.action_url.trim() : '';
  const taskType = req.body?.task_type;
  const cadence = req.body?.cadence;
  const xpReward = Number(req.body?.xp_reward);
  const pointsReward = Number(req.body?.points_reward);
  const active = req.body?.active === false ? 0 : 1;
  const validTypes = ['SOCIAL_CLICK', 'WITHDRAWAL'];
  const urlValid = (() => {
    try { return actionUrl.length <= 2048 && new URL(actionUrl).protocol === 'https:'; } catch { return false; }
  })();
  if ((taskId != null && (!Number.isInteger(taskId) || taskId <= 0)) ||
      title.length < 3 || title.length > 100 ||
      description.length < 3 || description.length > 500 ||
      !validTypes.includes(taskType) || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence) ||
      (taskType === 'SOCIAL_CLICK' && !urlValid) ||
      !Number.isSafeInteger(xpReward) || xpReward < 0 ||
      !Number.isSafeInteger(pointsReward) || pointsReward < 0) {
    return res.status(400).json({ error: 'Provide a valid task, cadence, action link (for social tasks), and non-negative XP and point rewards.' });
  }
  const values = [title, description, actionUrl || 'https://x.com/', taskType, cadence, xpReward, pointsReward, active];
  if (taskId == null) {
    return db.run(
      `INSERT INTO battlepass_tasks (title, description, action_url, task_type, cadence, xp_reward, points_reward, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
      function(insertErr) {
        if (insertErr) return res.status(500).json({ error: 'Unable to create the battle pass task.' });
        res.json({ success: true, task_id: this.lastID });
      }
    );
  }
  db.get('SELECT is_builtin FROM battlepass_tasks WHERE id = ?', [taskId], (taskErr, task) => {
    if (taskErr) return res.status(500).json({ error: 'Unable to load the battle pass task.' });
    if (!task) return res.status(404).json({ error: 'Battle pass task not found.' });
    if (Number(task.is_builtin) === 1) {
      return res.status(400).json({ error: 'Built-in activity tasks only allow their XP and point rewards to be changed.' });
    }
    db.run(
      `UPDATE battlepass_tasks SET title = ?, description = ?, action_url = ?, task_type = ?,
         cadence = ?, xp_reward = ?, points_reward = ?, active = ? WHERE id = ? AND is_builtin = 0`,
      [...values, taskId],
      function(updateErr) {
        if (updateErr) return res.status(500).json({ error: 'Unable to update the battle pass task.' });
        if (this.changes !== 1) return res.status(404).json({ error: 'Battle pass task not found.' });
        res.json({ success: true, task_id: taskId });
      }
    );
  });
});

app.get('/api/user/referrals', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested referrals.' });
  }

  db.all(
    `SELECT r.created_at, r.paid_amount, r.commission_earned, r.commission_pct, p.name as plan_name, u.username as buyer_username
     FROM referrals r
     JOIN plans p ON r.plan_id = p.id
     LEFT JOIN users u ON LOWER(r.referee_wallet) = LOWER(u.wallet_address)
     WHERE LOWER(r.referrer_wallet) = LOWER(?)
     ORDER BY r.created_at DESC`,
    [wallet],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ referrals: rows || [] });
    }
  );
});

app.post('/api/referrals/withdraw', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { wallet_address, amount } = req.body;
  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    return res.status(400).json({ error: "Invalid withdrawal parameters." });
  }

  const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return res.status(500).json({ error: 'Unable to start commission withdrawal.' });
      db.get(
        `SELECT COALESCE(SUM(commission_earned), 0) AS total_earned
         FROM referrals WHERE LOWER(referrer_wallet) = LOWER(?)`,
        [wallet_address],
        (earnedErr, earnedRow) => {
          if (earnedErr) return rollback(500, 'Unable to calculate commission balance.');
          db.get(
            `SELECT COALESCE(SUM(amount), 0) AS total_withdrawn
             FROM referral_withdrawals WHERE LOWER(wallet_address) = LOWER(?) AND status != 'REJECTED'`,
            [wallet_address],
            (withdrawnErr, withdrawnRow) => {
              if (withdrawnErr) return rollback(500, 'Unable to check prior commission withdrawals.');
              const available = Number(earnedRow.total_earned) - Number(withdrawnRow.total_withdrawn);
              if (amountValue > available) {
                return rollback(400, `Requested amount ($${amountValue}) exceeds available commission balance ($${available.toFixed(2)}).`);
              }

              const withdrawalId = `refw_${crypto.randomBytes(7).toString('hex')}`;
              db.run(
                `INSERT INTO referral_withdrawals (id, wallet_address, amount, status)
                 VALUES (?, ?, ?, 'PENDING')`,
                [withdrawalId, wallet_address, amountValue],
                (insertErr) => {
                  if (insertErr) return rollback(500, 'Unable to record commission withdrawal.');
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) return rollback(500, 'Unable to commit commission withdrawal.');
                    res.json({ success: true, message: 'Commission withdrawal requested successfully.' });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

app.post('/api/promo/validate', sensitiveLimiter, (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
  if (!code) return res.json({ valid: false });
  db.get('SELECT standard_discount_pct FROM battlepass_settings WHERE id = 1', [], (settingsErr, settings) => {
    if (settingsErr) return res.status(500).json({ error: 'Unable to load current purchase discounts.' });
    const standardDiscountPct = Number(settings?.standard_discount_pct ?? 90);
    db.get('SELECT wallet_address FROM users WHERE UPPER(discount_code) = ?', [code], (userErr, user) => {
      if (userErr) return res.status(500).json({ error: 'Unable to validate the promo code.' });
      if (user) {
        return res.json({ valid: true, type: 'CREATOR', discount_pct: standardDiscountPct });
      }
      db.get(
        `SELECT discount_bonus_pct FROM battlepass_reward_codes
         WHERE UPPER(code) = ? AND redeemed_at IS NULL`,
        [code],
        (rewardErr, reward) => {
          if (rewardErr) return res.status(500).json({ error: 'Unable to validate the reward code.' });
          if (!reward) return res.json({ valid: false, error: 'Invalid or already-used promo code.' });
          res.json({
            valid: true,
            type: 'BATTLEPASS',
            discount_pct: Math.min(100, standardDiscountPct + Number(reward.discount_bonus_pct)),
            bonus_discount_pct: Number(reward.discount_bonus_pct)
          });
        }
      );
    });
  });
});

app.get('/api/accounts', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested accounts.' });
  }

  db.all(
    `SELECT a.*, p.name as plan_name, p.profit_target, p.max_drawdown_pct, p.daily_loss_pct, p.simulated_capital 
     FROM accounts a 
     JOIN plans p ON a.plan_id = p.id 
     WHERE LOWER(a.wallet_address) = LOWER(?)`,
    [wallet],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ accounts: rows || [] });
    }
  );
});

app.get('/api/accounts/details', requireWalletSession, (req, res) => {
  const accountId = req.query.account_id;
  const wallet = req.query.wallet;
  if (!accountId || typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested account.' });
  }

  db.get(
    `SELECT wallet_address FROM accounts WHERE id = ?`,
    [accountId],
    (err, account) => {
      if (err) return res.status(500).json({ error: 'Unable to load account.' });
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ error: 'Wallet does not own this account.' });
      }

      refreshRiskBaselines(accountId, (baselineErr, refreshedAccount) => {
        if (baselineErr) return res.status(500).json({ error: 'Unable to update daily account baselines.' });
        account = refreshedAccount;
        refreshAccountLock(account, (unlockErr, activeLock) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        db.all(`SELECT * FROM trades WHERE account_id = ? ORDER BY created_at DESC`, [accountId], (err2, trades) => {
        if (err2) return res.status(500).json({ error: 'Unable to load account trades.' });
        const totalProfit = account.current_equity - account.initial_balance;
        const profitProgress = Math.min(100, Math.max(0, (totalProfit / account.profit_target) * 100));
        
        const maxAllowedDD = account.initial_balance * (account.max_drawdown_pct / 100);
        const mllFloor = getMllFloor(account, account);
        const riskBalance = getRiskBalance(account);
        const currentDD = Math.max(0, account.high_water_mark - riskBalance);
        const ddProgress = Math.min(100, Math.max(0, (currentDD / maxAllowedDD) * 100));

        const maxAllowedDLL = account.daily_starting_balance * (account.daily_loss_pct / 100);
        const currentDLL = Math.max(0, account.daily_starting_balance - riskBalance);
        const dllProgress = Math.min(100, Math.max(0, (currentDLL / maxAllowedDLL) * 100));
        const withdrawalFloor = getProtectedPayoutBalance(account.initial_balance, account.max_drawdown_pct);
        const withdrawableAmount = getAvailableGrossWithdrawal(
          account.current_balance,
          withdrawalFloor,
          Number(account.pending_withdrawal_amount || 0)
        );

        let consistencyScore = 100;
        if (trades && trades.length > 0) {
          const closedTrades = trades.filter(t => t.status === 'CLOSED');
          if (closedTrades.length > 0) {
            const profits = closedTrades.map(t => t.pnl);
            const maxWin = Math.max(...profits, 0);
            const totalPnLSum = profits.reduce((a, b) => a + b, 0);
            if (totalPnLSum > 0) {
              consistencyScore = Math.max(20, Math.round(100 - ((maxWin / totalPnLSum) * 50)));
            }
          }
        }

        db.all(
          `SELECT day, opening_balance, closing_balance, profit
           FROM daily_account_summaries WHERE account_id = ? ORDER BY day`,
          [accountId],
          (summaryErr, dailySummaries) => {
            if (summaryErr) return res.status(500).json({ error: 'Unable to load daily profit history.' });
            res.json({
              account,
              lock: activeLock,
              metrics: {
                profitProgress: profitProgress.toFixed(1),
                profitTarget: account.profit_target,
                currentProfit: totalProfit,
                ddProgress: ddProgress.toFixed(1),
                maxAllowedDD,
                currentDD,
                mllFloor,
                dllProgress: dllProgress.toFixed(1),
                maxAllowedDLL,
                currentDLL,
                withdrawalFloor,
                pendingWithdrawalAmount: Number(account.pending_withdrawal_amount || 0),
                withdrawableAmount,
                withdrawalPending: Number(account.pending_withdrawal_amount || 0) > 0,
                riskBalance,
                consistencyScore
              },
              dailySummaries: dailySummaries || [],
              trades: trades || []
            });
          }
        );
        });
      });
      });
    }
  );
});

// --- SECURE PURCHASE ENDPOINT (WITH MULTI-CHAIN ON-CHAIN VERIFICATION) ---
app.post('/api/accounts/purchase', sensitiveLimiter, requireWalletSession, async (req, res) => {
  const { wallet_address, plan_id, tx_hash, chain_id } = req.body;
  const promoCode = typeof req.body?.promo_code === 'string' ? req.body.promo_code.trim().toUpperCase() : '';
  if (typeof wallet_address !== 'string' || !ethers.isAddress(wallet_address) ||
      !Number.isInteger(Number(plan_id)) || Number(plan_id) <= 0 ||
      (req.body?.promo_code != null && (typeof req.body.promo_code !== 'string' || req.body.promo_code.length > 32))) {
    return res.status(400).json({ error: 'Missing required purchase parameters.' });
  }

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
  try {
    const [plan, settings] = await Promise.all([
      dbGet('SELECT * FROM plans WHERE id = ? AND active = 1', [Number(plan_id)]),
      dbGet('SELECT standard_discount_pct FROM battlepass_settings WHERE id = 1')
    ]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    const standardDiscountPct = Math.max(0, Math.min(100, Number(settings?.standard_discount_pct ?? 90)));
    let rewardCode = null;
    let referrerWallet = null;
    let referralCommissionPct = 2;
    let bonusDiscountPct = 0;
    if (promoCode) {
      const [creator, coupon] = await Promise.all([
        dbGet('SELECT wallet_address, referral_pct FROM users WHERE UPPER(discount_code) = ?', [promoCode]),
        dbGet(
          `SELECT code, wallet_address, discount_bonus_pct FROM battlepass_reward_codes
           WHERE UPPER(code) = ? AND redeemed_at IS NULL`,
          [promoCode]
        )
      ]);
      if (creator) {
        referrerWallet = creator.wallet_address;
        referralCommissionPct = Number(creator.referral_pct ?? 2);
      } else if (coupon && coupon.wallet_address.toLowerCase() === wallet_address.toLowerCase()) {
        rewardCode = coupon;
        bonusDiscountPct = Number(coupon.discount_bonus_pct);
      } else {
        return res.status(400).json({ error: 'Invalid, used, or wallet-bound promo code.' });
      }
    }

    const totalDiscountPct = Math.min(100, standardDiscountPct + bonusDiscountPct);
    const finalPrice = Math.round(Number(plan.base_price_usdt) * (100 - totalDiscountPct)) / 100;
    const isFreeRedemption = finalPrice === 0;
    let normalizedTxHash;
    let purchaseChainId = 0;
    if (!isFreeRedemption) {
      if (typeof tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash) ||
          !Number.isInteger(Number(chain_id))) {
        return res.status(400).json({ error: 'A valid payment transaction and network are required.' });
      }
      const verification = await verifyMultiChainPurchase(tx_hash, Number(chain_id), wallet_address, finalPrice, TREASURY_WALLET);
      if (!verification.success) return res.status(400).json({ error: verification.error });
      normalizedTxHash = tx_hash.toLowerCase();
      purchaseChainId = Number(chain_id);
    } else {
      normalizedTxHash = rewardCode
        ? `pass_${rewardCode.code.toLowerCase()}`
        : `free_${crypto.randomBytes(16).toString('hex')}`;
    }

    db.run('INSERT OR IGNORE INTO users (wallet_address) VALUES (?)', [wallet_address], (userErr) => {
      if (userErr) return res.status(500).json({ error: 'Unable to prepare the purchasing account.' });
      db.get(
        `SELECT COALESCE(xp_reward, 1000) AS xp_reward, COALESCE(points_reward, 100) AS points_reward
         FROM battlepass_plan_rewards WHERE plan_id = ?`,
        [Number(plan_id)],
        (rewardErr, planReward) => {
          if (rewardErr) return res.status(500).json({ error: 'Unable to load plan battle pass rewards.' });
          const xpAward = Number(planReward?.xp_reward ?? 1000);
          const pointsAward = Number(planReward?.points_reward ?? 100);
          const accountId = `acc_${crypto.randomBytes(8).toString('hex')}`;
          db.serialize(() => {
            db.run('BEGIN IMMEDIATE', (beginErr) => {
              if (beginErr) return res.status(500).json({ error: 'Unable to start account provisioning.' });
              const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
              db.run(
                `INSERT INTO purchases (tx_hash, chain_id, wallet_address, account_id)
                 VALUES (?, ?, ?, ?)`,
                [normalizedTxHash, purchaseChainId, wallet_address, accountId],
                (purchaseErr) => {
                  if (purchaseErr) return rollback(409, 'This transaction or discount code has already been used.');
                  const provisionAccount = () => db.run(
                    `INSERT INTO accounts (id, wallet_address, plan_id, initial_balance, current_balance,
                       current_equity, high_water_mark, daily_starting_balance, risk_day, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                    [
                      accountId, wallet_address, Number(plan_id), plan.simulated_capital,
                      plan.simulated_capital, plan.simulated_capital, plan.simulated_capital,
                      plan.simulated_capital, new Date().toISOString().slice(0, 10)
                    ],
                    (accountErr) => {
                      if (accountErr) return rollback(500, 'Unable to provision the purchased account.');
                      const commitPurchase = () => db.run('COMMIT', (commitErr) => {
                        if (commitErr) return rollback(500, 'Unable to commit account provisioning.');
                        if (referrerWallet && referrerWallet.toLowerCase() !== wallet_address.toLowerCase()) {
                          const commissionEarned = finalPrice * referralCommissionPct / 100;
                          db.run(
                            `INSERT INTO referrals (referrer_wallet, referee_wallet, plan_id, paid_amount, commission_earned, commission_pct)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [referrerWallet, wallet_address, Number(plan_id), finalPrice, commissionEarned, referralCommissionPct],
                            referralErr => {
                              if (referralErr) console.error('Unable to record referral commission:', referralErr.message);
                            }
                          );
                        }
                        res.json({
                          success: true,
                          account_id: accountId,
                          xp_awarded: isFreeRedemption ? 0 : xpAward,
                          points_awarded: isFreeRedemption ? 0 : pointsAward,
                          message: isFreeRedemption ? 'Free battle pass account provisioned successfully.' : 'Payment verified and account provisioned successfully.'
                        });
                      });
                      if (isFreeRedemption) return commitPurchase();
                      db.run('INSERT OR IGNORE INTO battlepass_users (wallet_address) VALUES (?)', [wallet_address], (battlePassErr) => {
                        if (battlePassErr) return rollback(500, 'Unable to prepare battle pass purchase rewards.');
                        db.run(
                          `UPDATE battlepass_users SET xp = xp + ?, points = points + ?, updated_at = CURRENT_TIMESTAMP
                           WHERE LOWER(wallet_address) = LOWER(?)`,
                          [xpAward, pointsAward, wallet_address],
                          (balanceErr) => {
                            if (balanceErr) return rollback(500, 'Unable to apply battle pass purchase rewards.');
                            db.run(
                              `INSERT INTO battlepass_events (id, wallet_address, event_type, reference_id, xp, points)
                               VALUES (?, ?, 'PURCHASE', ?, ?, ?)`,
                              [`bpe_${crypto.randomBytes(10).toString('hex')}`, wallet_address, normalizedTxHash, xpAward, pointsAward],
                              (eventErr) => eventErr
                                ? rollback(500, 'Unable to record battle pass purchase rewards.')
                                : commitPurchase()
                            );
                          }
                        );
                      });
                    }
                  );
                  if (!rewardCode) return provisionAccount();
                  db.run(
                    `UPDATE battlepass_reward_codes SET redeemed_at = CURRENT_TIMESTAMP
                     WHERE code = ? AND LOWER(wallet_address) = LOWER(?) AND redeemed_at IS NULL`,
                    [rewardCode.code, wallet_address],
                    function(redeemErr) {
                      if (redeemErr) return rollback(500, 'Unable to redeem the battle pass discount code.');
                      if (this.changes !== 1) return rollback(409, 'This battle pass discount code has already been used.');
                      provisionAccount();
                    }
                  );
                }
              );
            });
          });
        }
      );
    });
  } catch (error) {
    console.error('Unable to calculate purchase price:', error.message);
    return res.status(500).json({ error: 'Unable to calculate the current purchase price.' });
  }
});

// --- SECURE WITHDRAWAL REQUEST ENDPOINT ---
app.post('/api/withdrawals/request', sensitiveLimiter, requireTradeSignature, (req, res) => {
    const { account_id, wallet_address, amount } = req.body;
    const amountValue = Math.round(Number(amount) * 100) / 100;
    const userIp = req.ip;

    if (!account_id || !Number.isFinite(amountValue) || amountValue <= 0) {
        return res.status(400).json({ success: false, error: "Invalid request parameters." });
    }

    const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return res.status(500).json({ success: false, error: 'Unable to start withdrawal request.' });
        db.get(`
            SELECT a.*, p.name as plan_name, p.max_drawdown_pct
            FROM accounts a 
            JOIN plans p ON a.plan_id = p.id 
            WHERE a.id = ? AND LOWER(a.wallet_address) = LOWER(?)
        `, [account_id, wallet_address], (accountErr, account) => {
          if (accountErr) return rollback(500, 'Unable to load account.');
          if (!account) return rollback(404, 'Account not found or wallet mismatch.');
          if (Number(account.admin_frozen) === 1) return rollback(403, 'This account is frozen by an administrator.');
          if (account.status !== 'ACTIVE') return rollback(400, 'Account is not active.');

          db.get(
            `SELECT COALESCE(SUM(amount), 0) AS pending_amount, COUNT(*) AS pending_count FROM withdrawals
             WHERE account_id = ? AND status = 'PENDING'`,
            [account_id],
            (sumErr, row) => {
              if (sumErr) return rollback(500, 'Unable to verify pending payouts.');
              if (Number(row.pending_count) > 0) {
                return rollback(409, 'A withdrawal is already awaiting admin review; trading remains frozen until it is resolved.');
              }
              const withdrawalFloor = getProtectedPayoutBalance(account.initial_balance, account.max_drawdown_pct);
              const pendingAmount = Number(row.pending_amount) || 0;
              const maxAllowableWithdrawal = getAvailableGrossWithdrawal(
                account.current_balance,
                withdrawalFloor,
                pendingAmount
              );
              if (amountValue > maxAllowableWithdrawal) {
                return rollback(400, `Withdrawal exceeds the amount above the protected account balance of $${withdrawalFloor.toLocaleString()}. Available to request: $${maxAllowableWithdrawal.toFixed(2)} USDT.`);
              }

              const withdrawalId = `WDR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
              const { gross, userAmount, adminShare } = splitWithdrawal(amountValue);
              db.run(
                `INSERT INTO withdrawals
                 (id, account_id, wallet_address, type, plan_name, amount, user_amount, admin_share, user_ip, status, funds_deducted, created_at)
                 VALUES (?, ?, ?, 'PROFIT_SPLIT', ?, ?, ?, ?, ?, 'PENDING', 0, datetime('now'))`,
                [withdrawalId, account_id, wallet_address, account.plan_name, gross, userAmount, adminShare, userIp],
                (insertErr) => {
                  if (insertErr) return rollback(500, 'Unable to record withdrawal request.');
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) return rollback(500, 'Unable to complete withdrawal request.');
                    res.json({
                      success: true,
                      message: 'Withdrawal request submitted for admin review.',
                      gross_amount: gross,
                      user_amount: userAmount,
                      admin_share: adminShare,
                      protected_balance: withdrawalFloor
                    });
                  });
                }
              );
            }
          );
        });
      });
    });
});

app.post('/api/admin/withdrawals', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT w.id, w.account_id, w.wallet_address, w.amount, w.status, w.created_at, w.funds_deducted,
     'ACCOUNT' as type, p.name as plan_name, w.user_ip, a.current_balance AS account_balance,
     a.initial_balance, a.high_water_mark, a.admin_frozen, a.admin_freeze_reason,
     p.max_drawdown_pct,
     COALESCE(w.user_amount, ROUND(w.amount * 0.9, 2)) AS user_amount,
     COALESCE(w.admin_share, ROUND(w.amount - ROUND(w.amount * 0.9, 2), 2)) AS admin_share
     FROM withdrawals w 
     JOIN accounts a ON w.account_id = a.id 
     JOIN plans p ON a.plan_id = p.id 
     UNION ALL
     SELECT id as id, NULL as account_id, wallet_address, amount, status, created_at, NULL AS funds_deducted,
      'COMMISSION' as type, 'Referral Commission' as plan_name, NULL as account_balance,
      NULL AS initial_balance, NULL AS high_water_mark, NULL AS admin_frozen,
      NULL AS admin_freeze_reason, NULL AS max_drawdown_pct,
      amount AS user_amount, 0 AS admin_share, NULL as user_ip
     FROM referral_withdrawals
     ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Unable to load withdrawal queue.' });
      const withdrawals = rows || [];
      const accountIds = [...new Set(withdrawals.filter(row => row.type === 'ACCOUNT').map(row => row.account_id))];
      const tradesByAccount = new Map();
      const loadNext = (index) => {
        if (index >= accountIds.length) {
          return res.json({
            withdrawals: withdrawals.map(row => ({
              ...row,
              trades: row.type === 'ACCOUNT' ? (tradesByAccount.get(row.account_id) || []) : []
            }))
          });
        }
        const accountId = accountIds[index];
        db.all(
          `SELECT id, symbol, side, entry_price, size_usd, pnl, status, created_at, closed_at
           FROM trades WHERE account_id = ? ORDER BY created_at DESC`,
          [accountId],
          (tradeErr, trades) => {
            if (tradeErr) return res.status(500).json({ error: 'Unable to load account trade review.' });
            tradesByAccount.set(accountId, trades || []);
            loadNext(index + 1);
          }
        );
      };
      loadNext(0);
    }
  );
});

app.post('/api/admin/accounts', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  db.all(
    `SELECT a.id, a.wallet_address, a.plan_id, a.initial_balance, a.current_balance, a.current_equity,
     a.high_water_mark, a.daily_starting_balance, a.status, a.lock_reason, a.locked_until,
     a.permanent_lock, a.admin_frozen, a.admin_freeze_reason, p.name AS plan_name,
     p.max_drawdown_pct, p.daily_loss_pct,
     EXISTS(SELECT 1 FROM withdrawals w WHERE w.account_id = a.id AND w.status = 'PENDING') AS withdrawal_pending
     FROM accounts a JOIN plans p ON a.plan_id = p.id ORDER BY a.created_at DESC`,
    [],
    (err, accounts) => {
      if (err) return res.status(500).json({ error: 'Unable to load account management list.' });
      const rows = accounts || [];
      const loadNext = (index) => {
        if (index >= rows.length) return res.json({ accounts: rows });
        const row = rows[index];
        loadAccountWithLiveRisk(row.id, (riskErr, liveAccount) => {
          if (riskErr) return res.status(503).json({ error: `Unable to calculate live risk for account ${row.id}.` });
          refreshAccountLock(liveAccount, (lockErr, lock) => {
            if (lockErr) return res.status(500).json({ error: `Unable to apply risk lock for account ${row.id}.` });
            Object.assign(row, {
              risk_balance: getRiskBalance(liveAccount),
              status: liveAccount.status,
              lock_reason: liveAccount.lock_reason,
              locked_until: liveAccount.locked_until,
              permanent_lock: liveAccount.permanent_lock,
              risk_lock: lock || getActiveLock(liveAccount),
              open_trades: liveAccount.open_trades
            });
            db.all(
              `SELECT id, symbol, side, entry_price, size_usd, pnl, status, created_at, closed_at
               FROM trades WHERE account_id = ? ORDER BY created_at DESC`,
              [row.id],
              (tradeErr, trades) => {
                if (tradeErr) return res.status(500).json({ error: 'Unable to load account trade review.' });
                row.trades = trades || [];
                loadNext(index + 1);
              }
            );
          });
        });
      };
      loadNext(0);
    }
  );
});

app.post('/api/admin/accounts/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const { account_id, action } = req.body;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (typeof account_id !== 'string' || !account_id || !['FREEZE', 'UNFREEZE'].includes(action) ||
      (action === 'FREEZE' && (!reason || reason.length > 500))) {
    return res.status(400).json({ error: 'Account, action, and a freeze reason (up to 500 characters) are required.' });
  }
  if (action === 'FREEZE') {
    return db.run(
      `UPDATE accounts SET admin_frozen = 1, admin_freeze_reason = ? WHERE id = ?`,
      [reason, account_id],
      function(err) {
        if (err) return res.status(500).json({ error: 'Unable to freeze account.' });
        if (this.changes !== 1) return res.status(404).json({ error: 'Account not found.' });
        res.json({ success: true, message: 'Account frozen. New trades and withdrawals are disabled.' });
      }
    );
  }
  db.run(
    `UPDATE accounts SET admin_frozen = 0, admin_freeze_reason = NULL WHERE id = ? AND admin_frozen = 1`,
    [account_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Unable to unfreeze account.' });
      if (this.changes !== 1) return res.status(409).json({ error: 'Account is not currently frozen or was not found.' });
      res.json({ success: true, message: 'Administrator freeze removed. Any active risk lock remains in effect.' });
    }
  );
});

app.post('/api/admin/withdrawals/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const { withdrawal_id, action, type } = req.body;
  const normalizedAction = action === 'APPROVE' ? 'PAID' : action;
  if (!withdrawal_id || !['REJECT', 'PAID'].includes(normalizedAction) || !['ACCOUNT', 'COMMISSION'].includes(type)) {
    return res.status(400).json({ error: "A valid withdrawal ID and action are required." });
  }

  const isCommission = type === 'COMMISSION';
  const tableName = isCommission ? 'referral_withdrawals' : 'withdrawals';
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return res.status(500).json({ error: 'Unable to start withdrawal update.' });
      db.get(`SELECT * FROM ${tableName} WHERE id = ?`, [withdrawal_id], (err, wdr) => {
        const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
        if (err) return rollback(500, 'Unable to load withdrawal request.');
        if (!wdr) return rollback(404, 'Withdrawal request not found.');
        if (wdr.status !== 'PENDING') return rollback(409, 'Request already processed.');

        const updateStatus = () => db.run(
          `UPDATE ${tableName} SET status = ?, paid_at = CASE WHEN ? = 'PAID' THEN CURRENT_TIMESTAMP ELSE paid_at END${isCommission ? '' : ", funds_deducted = CASE WHEN ? = 'PAID' THEN 1 ELSE funds_deducted END"}
           WHERE id = ? AND status = 'PENDING'`,
          isCommission
            ? [normalizedAction === 'REJECT' ? 'REJECTED' : 'PAID', normalizedAction, withdrawal_id]
            : [normalizedAction === 'REJECT' ? 'REJECTED' : 'PAID', normalizedAction, normalizedAction, withdrawal_id],
          function(updateErr) {
            if (updateErr) return rollback(500, 'Unable to update withdrawal status.');
            if (this.changes !== 1) return rollback(409, 'Request already processed.');
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return rollback(500, 'Unable to commit withdrawal update.');
              res.json({ success: true, message: `Withdrawal marked as ${normalizedAction}.` });
            });
          }
        );

        if (isCommission || !wdr.account_id) return updateStatus();
        if (normalizedAction === 'REJECT') {
          if (Number(wdr.funds_deducted) !== 1) return updateStatus();
          return db.run(
            `UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?`,
            [wdr.amount, wdr.account_id],
            (refundErr) => {
              if (refundErr) return rollback(500, 'Unable to return previously reserved withdrawal funds.');
              updateStatus();
            }
          );
        }
        if (Number(wdr.funds_deducted) === 1) return updateStatus();
        db.get(
          `SELECT a.current_balance, a.current_equity, a.daily_starting_balance, a.admin_frozen,
           a.initial_balance, p.max_drawdown_pct
           FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
          [wdr.account_id],
          (accountErr, account) => {
            if (accountErr) return rollback(500, 'Unable to load account for withdrawal approval.');
            if (!account) return rollback(404, 'Withdrawal account not found.');
            if (Number(account.admin_frozen) === 1) return rollback(409, 'Unfreeze this account before approving the withdrawal.');
            const withdrawalFloor = getProtectedPayoutBalance(account.initial_balance, account.max_drawdown_pct);
            db.get(
              `SELECT COALESCE(SUM(amount), 0) AS other_pending FROM withdrawals
               WHERE account_id = ? AND status = 'PENDING' AND id != ?`,
              [wdr.account_id, withdrawal_id],
              (pendingErr, pendingRow) => {
                if (pendingErr) return rollback(500, 'Unable to check other pending withdrawals.');
                if (account.current_balance - wdr.amount - Number(pendingRow.other_pending) < withdrawalFloor - 0.005) {
                  return rollback(409, `Approval would reduce account balance or remaining pending payouts below its protected $${withdrawalFloor.toFixed(2)} floor.`);
                }
                db.run(
                  `UPDATE accounts
                   SET current_balance = current_balance - ?,
                       current_equity = current_equity - ?,
                       daily_starting_balance = daily_starting_balance - ?
                   WHERE id = ? AND current_balance - ? >= ? AND admin_frozen = 0`,
                  [wdr.amount, wdr.amount, wdr.amount, wdr.account_id, wdr.amount, withdrawalFloor],
                  function(balanceErr) {
                    if (balanceErr) return rollback(500, 'Unable to deduct approved withdrawal.');
                    if (this.changes !== 1) return rollback(409, 'Account balance changed; refresh and retry.');
                    updateStatus();
                  }
                );
              }
            );
          }
        );
      });
    });
  });
});

app.post('/api/trades/execute', sensitiveLimiter, requireWalletSession, (req, res) => {
  const { account_id, symbol, side, price, size_usd, margin_used, leverage, sl, tp, wallet_address } = req.body;
  const market = markets.find(item => item.symbol === symbol);
  const numericFields = [price, size_usd, margin_used, leverage];
  if (!account_id || !market || market.enabled === false || !['BUY', 'SELL'].includes(side) ||
      numericFields.some(value => !Number.isFinite(Number(value)) || Number(value) <= 0) ||
      !Number.isInteger(Number(leverage)) || Number(leverage) > 50 ||
      Math.abs(Number(size_usd) - Number(margin_used) * Number(leverage)) > 0.01 ||
      (sl != null && (!Number.isFinite(Number(sl)) || Number(sl) <= 0)) ||
      (tp != null && (!Number.isFinite(Number(tp)) || Number(tp) <= 0))) {
    return res.status(400).json({ error: 'Invalid trade parameters.' });
  }

  db.get(
    `SELECT a.*, p.max_drawdown_pct, p.daily_loss_pct,
     COALESCE((SELECT SUM(w.amount) FROM withdrawals w
       WHERE w.account_id = a.id AND w.status = 'PENDING'), 0) AS pending_withdrawal_amount
     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
    [account_id],
    (err, account) => {
      if (err) return res.status(500).json({ error: 'Unable to load account.' });
      if (!account) return res.status(404).json({ error: 'Account not found.' });
      if (account.wallet_address.toLowerCase() !== req.walletAddress) {
        return res.status(403).json({ error: 'Wallet does not own this account.' });
      }

      refreshRiskBaselines(account_id, (baselineErr, refreshedAccount) => {
      if (baselineErr) return res.status(500).json({ error: 'Unable to update daily account baselines.' });
      account = refreshedAccount;
      unlockExpiredAccount(account, (unlockErr, activeLock) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        if (Number(account.admin_frozen) === 1) {
          return res.status(403).json({ error: `Account is frozen by an administrator${account.admin_freeze_reason ? `: ${account.admin_freeze_reason}` : '.'}` });
        }
        if (activeLock) {
          const message = activeLock.permanent
            ? 'Account permanently locked after exceeding the maximum loss limit (MLL).'
            : `Account locked for DLL breach until ${activeLock.lockedUntil}.`;
          return res.status(403).json({ error: message, lock: activeLock });
        }

        if (account.status !== 'ACTIVE') {
          return res.status(403).json({ error: `Account is not active (${account.status}).` });
        }

        if (Number(account.pending_withdrawal_amount) > 0) {
          return res.status(403).json({ error: 'Trading is temporarily frozen while a withdrawal awaits admin review.' });
        }

        const existingBreach = getRiskBreach(account, account);
        if (existingBreach) {
          return applyRiskBreach(account, existingBreach, (lockErr, appliedLock) => {
            if (lockErr) return res.status(500).json({ error: 'Unable to apply account risk lock.' });
            res.status(403).json({
              error: appliedLock.permanent
                ? 'Account permanently locked after exceeding the maximum loss limit (MLL).'
                : `Account locked for DLL breach until ${appliedLock.lockedUntil}.`,
              lock: appliedLock
            });
          });
        }

        const margin = Number(margin_used);
        if (margin > account.current_balance) {
          return res.status(400).json({ error: `Insufficient available balance ($${account.current_balance.toFixed(2)} available).` });
        }

        getAuthoritativePrice(market).then((marketPrice) => {
          const slippage = market.source === 'BITGET_PERP' ? marketPrice * 0.0005 : 5;
          const executionPrice = marketPrice + (side === 'BUY' ? slippage : -slippage);
          if (executionPrice <= 0 ||
              (side === 'BUY' && ((sl && Number(sl) >= executionPrice) || (tp && Number(tp) <= executionPrice))) ||
              (side === 'SELL' && ((sl && Number(sl) <= executionPrice) || (tp && Number(tp) >= executionPrice)))) {
            return res.status(400).json({ error: 'Stop loss, take profit, or execution price is invalid for this side.' });
          }

          const units = Number(size_usd) / executionPrice;
          const tradeId = `trd_${crypto.randomBytes(8).toString('hex')}`;
          db.serialize(() => {
            db.run('BEGIN IMMEDIATE');
            db.run(
              `UPDATE accounts SET current_balance = current_balance - ?
               WHERE id = ? AND current_balance >= ? AND status = 'ACTIVE' AND admin_frozen = 0
               AND NOT EXISTS (SELECT 1 FROM withdrawals WHERE account_id = ? AND status = 'PENDING')`,
              [margin, account_id, margin, account_id],
              function(updateErr) {
                if (updateErr || this.changes !== 1) {
                  return db.run('ROLLBACK', () => res.status(409).json({ error: 'Account balance or status changed. Refresh and retry.' }));
                }
                db.run(
                  `INSERT INTO trades (id, account_id, symbol, side, entry_price, size_usd, units, sl, tp, status, leverage)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
                  [tradeId, account_id, symbol, side, executionPrice, margin, units, sl || null, tp || null, leverage],
                  (insertErr) => {
                    if (insertErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to create trade.' }));
                    db.run('COMMIT', (commitErr) => {
                      if (commitErr) return res.status(500).json({ error: 'Unable to commit trade.' });
                      res.json({ success: true, trade_id: tradeId, execution_price: executionPrice });
                    });
                  }
                );
              }
            );
          });
        }).catch((priceError) => {
          console.error('Unable to obtain trade execution price:', priceError.message);
          res.status(503).json({ error: 'Unable to obtain a fresh market price. Please retry.' });
        });
      });
      });
    }
  );
});

app.post('/api/trades/close', sensitiveLimiter, requireWalletSession, (req, res) => {
  const { trade_id, wallet_address } = req.body;
  if (!trade_id) return res.status(400).json({ error: 'Trade ID is required.' });

  db.get(
    `SELECT t.*, a.wallet_address, a.current_equity, a.daily_starting_balance,
     a.status AS account_status, a.lock_reason, a.locked_until, a.permanent_lock
     FROM trades t JOIN accounts a ON a.id = t.account_id
     WHERE t.id = ? AND t.status = 'OPEN'`,
    [trade_id],
    (err, trade) => {
      if (err) return res.status(500).json({ error: 'Unable to load trade.' });
      if (!trade) return res.status(404).json({ error: 'Open trade not found.' });
      if (trade.wallet_address.toLowerCase() !== req.walletAddress) {
        return res.status(403).json({ error: 'Wallet does not own this trade.' });
      }

      refreshRiskBaselines(trade.account_id, (baselineErr, refreshedAccount) => {
      if (baselineErr) return res.status(500).json({ error: 'Unable to update daily account baselines.' });
      const account = {
        id: trade.account_id,
        current_equity: refreshedAccount.current_equity,
        risk_balance: refreshedAccount.risk_balance,
        daily_starting_balance: refreshedAccount.daily_starting_balance,
        status: refreshedAccount.status,
        lock_reason: refreshedAccount.lock_reason,
        locked_until: refreshedAccount.locked_until,
        permanent_lock: refreshedAccount.permanent_lock
      };
      unlockExpiredAccount(account, (unlockErr) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        const market = getTradeMarket(trade.symbol);
        if (!market) return res.status(409).json({ error: 'The trade market is no longer configured.' });
        getAuthoritativePrice(market).then((price) => {
        const priceDiff = trade.side === 'BUY' ? price - trade.entry_price : trade.entry_price - price;
        const pnl = priceDiff * trade.units;
        const returnedMargin = getTradeMargin(trade) + pnl;
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');
          db.run(
            `UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'OPEN'`,
            [pnl, trade_id],
            function(updateErr) {
              if (updateErr || this.changes !== 1) {
                return db.run('ROLLBACK', () => res.status(409).json({ error: 'Trade was already closed.' }));
              }
              db.run(
                `UPDATE accounts SET current_balance = current_balance + ?, current_equity = current_equity + ?
                 WHERE id = ?`,
                [returnedMargin, pnl, trade.account_id],
                (balanceErr) => {
                  if (balanceErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to settle trade.' }));
                  loadAccountWithLiveRisk(trade.account_id, (accountErr, account) => {
                      if (accountErr || !account) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to verify account limits.' }));
                      const breach = getRiskBreach(account, account);
                      const activeLock = breach || getActiveLock(account);
                      const commit = (lock = null) => db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: 'Unable to commit trade settlement.' });
                        res.json({ success: true, pnl, lock });
                      });
                      if (!breach) return commit(activeLock);
                      settleBreachWithinTransaction(account, breach, (lockErr, appliedLock) => {
                        if (lockErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to apply account lock.' }));
                        commit({
                          reason: appliedLock.reason,
                          permanent: appliedLock.permanent,
                          lockedUntil: appliedLock.lockedUntil
                        });
                      });
                    });
                }
              );
            }
          );
        });
        }).catch((priceError) => {
          console.error('Unable to obtain trade closing price:', priceError.message);
          res.status(503).json({ error: 'Unable to obtain a fresh market price. Please retry.' });
        });
      });
      });
    }
  );
});

app.get('/api/trades/active', requireWalletSession, (req, res) => {
  const accountId = req.query.account_id;
  const wallet = req.query.wallet;
  if (!accountId || typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested trades.' });
  }

  db.get("SELECT wallet_address FROM accounts WHERE id = ?", [accountId], (accountErr, account) => {
    if (accountErr) return res.status(500).json({ error: 'Unable to load account.' });
    if (!account || account.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(403).json({ error: 'Wallet does not own this account.' });
    }
    refreshRiskBaselines(accountId, (baselineErr, liveAccount) => {
      if (baselineErr) return res.status(503).json({ error: 'Unable to calculate live account risk.' });
      refreshAccountLock(liveAccount, (lockErr, lock) => {
        if (lockErr) return res.status(500).json({ error: 'Unable to apply account risk lock.' });
        res.json({
          trades: liveAccount.open_trades || [],
          risk_balance: getRiskBalance(liveAccount),
          lock: lock || getActiveLock(liveAccount),
          account_status: liveAccount.status,
          lock_reason: liveAccount.lock_reason
        });
      });
    });
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
  console.log(`Blastrr server running on port ${PORT}`);
});
