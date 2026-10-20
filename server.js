const express = require('express');
const path = require('path');
const https = require('https');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 4480;

// --- 1. PROXY TRUST CONFIGURATION ---
// Required behind Nginx reverse proxy to capture true client IP addresses via req.ip
app.set('trust proxy', 'loopback');

app.use(express.json());
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

const sensitiveLimiter = createRateLimiter(30, 60000); // 30 requests max per minute per IP

let cachedPrices = {};
let lastFetchTime = 0;

async function getCachedBinancePrice(symbol) {
    const now = Date.now();
    if (now - lastFetchTime < 1500 && cachedPrices[symbol]) {
        return cachedPrices[symbol];
    }
    try {
        const pair = symbol.replace('BINANCE:', '');
        return new Promise((resolve) => {
            https.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (parsed && parsed.price) {
                            cachedPrices[symbol] = parseFloat(parsed.price);
                            lastFetchTime = now;
                            resolve(cachedPrices[symbol]);
                        } else {
                            resolve(cachedPrices[symbol] || 0);
                        }
                    } catch (e) { resolve(cachedPrices[symbol] || 0); }
                });
            }).on('error', () => resolve(cachedPrices[symbol] || 0));
        });
    } catch (err) {
        return cachedPrices[symbol] || 0;
    }
}

function seedPlans() {
  db.get("SELECT COUNT(*) as count FROM plans", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO plans (name, base_price_usdt, price_usdt, simulated_capital, profit_target, max_drawdown_pct, daily_loss_pct, max_single_day_profit_pct) VALUES 
        ('Micro $5k', 500.00, 50.00, 5000, 1000, 10.0, 5.0, 40.0),
        ('Starter $10k', 1000.00, 100.00, 10000, 2000, 10.0, 5.0, 40.0),
        ('Trader $20k', 2000.00, 200.00, 20000, 4000, 10.0, 5.0, 40.0),
        ('Pro $50k', 5000.00, 500.00, 50000, 10000, 10.0, 5.0, 40.0),
        ('Elite $100k', 10000.00, 1000.00, 100000, 20000, 10.0, 5.0, 40.0),
        ('Whale $250k', 25000.00, 2500.00, 250050, 50000, 10.0, 5.0, 40.0)`);
      console.log("Blastrr 6-Tier evaluation plans successfully seeded.");
    }
  });
}

setTimeout(seedPlans, 1000);

function getLiveBinancePrice(symbol) {
  return getCachedBinancePrice(symbol);
}

// Background Monitor: Automatically Checks & Closes SL/TP Hits Every 1.5 Seconds
async function monitorStopLossAndTakeProfit() {
  db.all("SELECT * FROM trades WHERE status = 'OPEN'", async (err, openTrades) => {
    if (err || !openTrades || openTrades.length === 0) return;

    const uniqueSymbols = [...new Set(openTrades.map(t => t.symbol))];
    const livePrices = {};

    for (const sym of uniqueSymbols) {
      const price = await getLiveBinancePrice(sym);
      if (price) livePrices[sym] = price;
    }

    for (const trade of openTrades) {
      const currentPrice = livePrices[trade.symbol];
      if (!currentPrice) continue;

      let shouldClose = false;
      let triggerReason = '';

      if (trade.side === 'BUY') {
        if (trade.sl && currentPrice <= trade.sl) {
          shouldClose = true;
          triggerReason = 'STOP_LOSS';
        } else if (trade.tp && currentPrice >= trade.tp) {
          shouldClose = true;
          triggerReason = 'TAKE_PROFIT';
        }
      } else if (trade.side === 'SELL') {
        if (trade.sl && currentPrice >= trade.sl) {
          shouldClose = true;
          triggerReason = 'STOP_LOSS';
        } else if (trade.tp && currentPrice <= trade.tp) {
          shouldClose = true;
          triggerReason = 'TAKE_PROFIT';
        }
      }

      if (shouldClose) {
        closeTradeInternal(trade, currentPrice, triggerReason);
      }
    }
  });
}

function closeTradeInternal(trade, currentMarketPrice, reason) {
  const priceDiff = trade.side === 'BUY' ? (currentMarketPrice - trade.entry_price) : (trade.entry_price - currentMarketPrice);
  const pnl = priceDiff * trade.units;
  const returnAmount = trade.size_usd + pnl;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run(`UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'OPEN'`, [pnl, trade.id], function(err) {
      if (!err && this.changes > 0) {
        db.run(`UPDATE accounts SET current_balance = current_balance + ?, current_equity = current_equity + ? WHERE id = ?`, [returnAmount, pnl, trade.account_id]);
        db.run("COMMIT");
        console.log(`[SL/TP ENGINE] Trade ${trade.id} Auto-Closed via ${reason} at $${currentMarketPrice}. Realized PnL: $${pnl.toFixed(2)}`);
      } else {
        db.run("ROLLBACK");
      }
    });
  });
}

setInterval(monitorStopLossAndTakeProfit, 1500);

app.get('/api/plans', (req, res) => {
  db.all("SELECT * FROM plans", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ plans: rows });
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
      SELECT u.username, u.discount_code, u.wallet_address, SUM(t.pnl) as metric_value
      FROM users u
      JOIN accounts a ON LOWER(u.wallet_address) = LOWER(a.wallet_address)
      JOIN trades t ON a.id = t.account_id
      WHERE t.status = 'CLOSED' AND u.username IS NOT NULL AND strftime('%Y-%m-%d', t.closed_at) = strftime('%Y-%m-%d', 'now')
      GROUP BY u.wallet_address
      ORDER BY metric_value DESC
      LIMIT 100;
    `;
  } else if (mode === 'MONTHLY') {
    query = `
      SELECT u.username, u.discount_code, u.wallet_address, SUM(t.pnl) as metric_value
      FROM users u
      JOIN accounts a ON LOWER(u.wallet_address) = LOWER(a.wallet_address)
      JOIN trades t ON a.id = t.account_id
      WHERE t.status = 'CLOSED' AND u.username IS NOT NULL AND strftime('%Y-%m', t.closed_at) = strftime('%Y-%m', 'now')
      GROUP BY u.wallet_address
      ORDER BY metric_value DESC
      LIMIT 100;
    `;
  } else if (mode === 'PAYOUTS') {
    query = `
      SELECT u.username, u.discount_code, u.wallet_address, SUM(w.amount) as metric_value
      FROM users u
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

app.get('/api/user/profile', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });

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

app.post('/api/user/profile', sensitiveLimiter, (req, res) => {
  const { wallet_address, username, discount_code } = req.body;
  if (!wallet_address || !username || !discount_code) {
    return res.status(400).json({ error: "Username and promo code are required." });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanCode = discount_code.trim().toUpperCase();

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

app.get('/api/user/referrals', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });

  db.all(
    `SELECT r.created_at, r.paid_amount, r.commission_earned, p.name as plan_name, u.username as buyer_username
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

app.post('/api/referrals/withdraw', sensitiveLimiter, (req, res) => {
  const { wallet_address, amount } = req.body;
  if (!wallet_address || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid withdrawal parameters." });
  }

  db.all(
    `SELECT SUM(commission_earned) as total_earned FROM referrals WHERE LOWER(referrer_wallet) = LOWER(?)`,
    [wallet_address],
    (err, earnedRows) => {
      db.all(
        `SELECT SUM(amount) as total_withdrawn FROM referral_withdrawals WHERE LOWER(wallet_address) = LOWER(?) AND status != 'REJECTED'`,
        [wallet_address],
        (err2, withdrawnRows) => {
          const totalEarned = earnedRows[0]?.total_earned || 0;
          const totalWithdrawn = withdrawnRows[0]?.total_withdrawn || 0;
          const available = totalEarned - totalWithdrawn;

          if (amount > available) {
            return res.status(400).json({ error: `Requested amount ($${amount}) exceeds available commission balance ($${available.toFixed(2)}).` });
          }

          const wdrId = 'refw_' + Math.random().toString(36).substring(2, 11);
          db.run(
            `INSERT INTO referral_withdrawals (id, wallet_address, amount, status) VALUES (?, ?, ?, 'PENDING')`,
            [wdrId, wallet_address, amount],
            (err3) => {
              if (err3) return res.status(500).json({ error: err3.message });
              res.json({ success: true, message: "Commission withdrawal requested successfully." });
            }
          );
        }
      );
    }
  );
});

app.post('/api/promo/validate', sensitiveLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  db.get("SELECT * FROM users WHERE discount_code = ?", [code.toUpperCase()], (err, user) => {
    if (err || !user) return res.json({ valid: false, error: "Invalid promo code." });
    res.json({ valid: true, referrer_wallet: user.wallet_address, discount_pct: 90 });
  });
});

app.get('/api/accounts', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });

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

app.get('/api/accounts/details', (req, res) => {
  const accountId = req.query.account_id;
  if (!accountId) return res.status(400).json({ error: "Account ID required" });

  db.get(
    `SELECT a.*, p.name as plan_name, p.profit_target, p.max_drawdown_pct, p.daily_loss_pct, p.simulated_capital 
     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
    [accountId],
    (err, account) => {
      if (err || !account) return res.status(404).json({ error: "Account not found" });

      db.all(`SELECT * FROM trades WHERE account_id = ? ORDER BY created_at DESC`, [accountId], (err2, trades) => {
        const totalProfit = account.current_equity - account.initial_balance;
        const profitProgress = Math.min(100, Math.max(0, (totalProfit / account.profit_target) * 100));
        
        const maxAllowedDD = account.initial_balance * (account.max_drawdown_pct / 100);
        const currentDD = Math.max(0, account.initial_balance - account.current_equity);
        const ddProgress = Math.min(100, Math.max(0, (currentDD / maxAllowedDD) * 100));

        const maxAllowedDLL = account.initial_balance * (account.daily_loss_pct / 100);
        const currentDLL = Math.max(0, account.daily_starting_balance - account.current_equity);
        const dllProgress = Math.min(100, Math.max(0, (currentDLL / maxAllowedDLL) * 100));

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

        res.json({
          account,
          metrics: {
            profitProgress: profitProgress.toFixed(1),
            profitTarget: account.profit_target,
            currentProfit: totalProfit,
            ddProgress: ddProgress.toFixed(1),
            maxAllowedDD,
            currentDD,
            dllProgress: dllProgress.toFixed(1),
            maxAllowedDLL,
            currentDLL,
            consistencyScore
          },
          trades: trades || []
        });
      });
    }
  );
});

app.post('/api/accounts/purchase', sensitiveLimiter, (req, res) => {
  const { wallet_address, plan_id, tx_hash, promo_code } = req.body;

  if (!wallet_address || !plan_id) {
    return res.status(400).json({ error: "Wallet address and plan ID are required." });
  }

  db.run(`INSERT OR IGNORE INTO users (wallet_address) VALUES (?)`, [wallet_address], () => {
    db.get("SELECT * FROM plans WHERE id = ?", [plan_id], (err, plan) => {
      if (err || !plan) return res.status(404).json({ error: "Plan not found." });

      let finalPrice = plan.base_price_usdt;
      let referrerWallet = null;

      const finishPurchase = () => {
        const accountId = 'acc_' + Math.random().toString(36).substring(2, 11);

        db.run(
          `INSERT INTO accounts (id, wallet_address, plan_id, initial_balance, current_balance, current_equity, high_water_mark, daily_starting_balance, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
          [accountId, wallet_address, plan_id, plan.simulated_capital, plan.simulated_capital, plan.simulated_capital, plan.simulated_capital, plan.simulated_capital],
          (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });

            if (referrerWallet && referrerWallet.toLowerCase() !== wallet_address.toLowerCase()) {
              const commissionEarned = finalPrice * 0.02;
              db.run(
                `INSERT INTO referrals (referrer_wallet, referee_wallet, plan_id, paid_amount, commission_earned)
                 VALUES (?, ?, ?, ?, ?)`,
                [referrerWallet, wallet_address, plan_id, finalPrice, commissionEarned]
              );
            }

            res.json({ success: true, account_id: accountId, message: "Account provisioned successfully." });
          }
        );
      };

      if (promo_code) {
        db.get("SELECT * FROM users WHERE discount_code = ?", [promo_code.toUpperCase()], (err3, referrer) => {
          if (referrer) {
            referrerWallet = referrer.wallet_address;
            finalPrice = plan.price_usdt;
          }
          finishPurchase();
        });
      } else {
        finishPurchase();
      }
    });
  });
});

// --- SECURE WITHDRAWAL REQUEST ENDPOINT ---
app.post('/api/withdrawals/request', sensitiveLimiter, async (req, res) => {
    const { account_id, wallet_address, amount } = req.body;
    const userIp = req.ip;

    if (!account_id || !wallet_address || !amount || amount <= 0) {
        return res.status(400).json({ success: false, error: "Invalid request parameters." });
    }

    try {
        const account = db.prepare(`
            SELECT a.*, p.profit_target, p.simulated_capital 
            FROM user_accounts a 
            JOIN plans p ON a.plan_id = p.id 
            WHERE a.id = ? AND LOWER(a.wallet_address) = LOWER(?)
        `).get(account_id, wallet_address);

        if (!account) {
            return res.status(404).json({ success: false, error: "Account not found or wallet mismatch." });
        }

        if (account.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, error: "Account is not active." });
        }

        const initialCapital = account.initial_balance;
        const profitTargetDollar = account.profit_target;
        const targetThreshold = initialCapital + profitTargetDollar;

        if (account.current_balance < targetThreshold) {
            const shortFall = targetThreshold - account.current_balance;
            return res.status(400).json({ 
                success: false, 
                error: `Account not ready for withdrawal. Please meet the minimum requirements before making a withdrawal. You need $${shortFall.toLocaleString()} more profit to reach your $${targetThreshold.toLocaleString()} target.` 
            });
        }

        const netProfit = account.current_balance - initialCapital;
        const maxAllowableWithdrawal = netProfit * 0.50;

        if (amount > maxAllowableWithdrawal) {
            return res.status(400).json({ 
                success: false, 
                error: `Withdrawal exceeds maximum allowed payout! Your 50% profit split limit is $${maxAllowableWithdrawal.toLocaleString()} USDT.` 
            });
        }

        const withdrawalId = 'WDR-' + Math.random().toString(36).substring(2, 9).toUpperCase();
        
        db.prepare(`
            INSERT INTO withdrawals (id, account_id, wallet_address, type, plan_name, amount, user_ip, status, created_at)
            VALUES (?, ?, ?, 'PROFIT_SPLIT', ?, ?, ?, 'PENDING', datetime('now'))
        `).run(withdrawalId, account_id, wallet_address, account.plan_name, amount, userIp);

        res.json({ success: true, message: "Withdrawal request submitted successfully to the admin queue!" });

    } catch (err) {
        console.error("Withdrawal error:", err);
        res.status(500).json({ success: false, error: "Internal server error during withdrawal processing." });
    }
});

app.get('/api/admin/withdrawals', (req, res) => {
  db.all(
    `SELECT w.*, 'ACCOUNT' as type, p.name as plan_name 
     FROM withdrawals w 
     JOIN accounts a ON w.account_id = a.id 
     JOIN plans p ON a.plan_id = p.id 
     UNION ALL
     SELECT id as id, NULL as account_id, wallet_address, amount, status, created_at, 'COMMISSION' as type, 'Referral Commission' as plan_name, NULL as user_ip 
     FROM referral_withdrawals
     ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ withdrawals: rows || [] });
    }
  );
});

app.post('/api/admin/withdrawals/action', sensitiveLimiter, (req, res) => {
  const { withdrawal_id, action, type } = req.body; 
  if (!withdrawal_id || !action) return res.status(400).json({ error: "Missing parameters." });

  const isCommission = type === 'COMMISSION' || withdrawal_id.startsWith('refw_');
  const tableName = isCommission ? 'referral_withdrawals' : 'withdrawals';

  db.get(`SELECT * FROM ${tableName} WHERE id = ?`, [withdrawal_id], (err, wdr) => {
    if (err || !wdr) return res.status(404).json({ error: "Withdrawal request not found." });
    if (wdr.status !== 'PENDING') return res.status(400).json({ error: "Request already processed." });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      if (action === 'REJECT') {
        if (!isCommission && wdr.account_id) {
          db.run("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?", [wdr.amount, wdr.account_id]);
        }
        db.run(`UPDATE ${tableName} SET status = 'REJECTED' WHERE id = ?`, [withdrawal_id]);
      } else if (action === 'PAID') {
        db.run(`UPDATE ${tableName} SET status = 'PAID' WHERE id = ?`, [withdrawal_id]);
      }

      db.run("COMMIT");
      res.json({ success: true, message: `Withdrawal marked as ${action}.` });
    });
  });
});

app.post('/api/trades/execute', sensitiveLimiter, (req, res) => {
  const { account_id, symbol, side, price, size_usd, sl, tp } = req.body;

  if (!account_id || !symbol || !side || !price || !size_usd) {
    return res.status(400).json({ error: "Missing required trade parameters." });
  }

  db.get("SELECT * FROM accounts WHERE id = ?", [account_id], (err, account) => {
    if (err || !account) return res.status(404).json({ error: "Account not found." });

    if (size_usd > account.current_balance) {
      return res.status(400).json({ error: `Insufficient available balance ($${account.current_balance.toFixed(2)} available).` });
    }

    const slip = 5.0;
    const executionPrice = side === 'BUY' ? price + slip : price - slip;

    // Validate SL / TP logic to prevent instant triggering upon creation
    if (side === 'BUY') {
      if (sl && sl >= executionPrice) {
        return res.status(400).json({ error: "Stop Loss for a BUY order must be below the execution price." });
      }
      if (tp && tp <= executionPrice) {
        return res.status(400).json({ error: "Take Profit for a BUY order must be above the execution price." });
      }
    } else if (side === 'SELL') {
      if (sl && sl <= executionPrice) {
        return res.status(400).json({ error: "Stop Loss for a SELL order must be above the execution price." });
      }
      if (tp && tp >= executionPrice) {
        return res.status(400).json({ error: "Take Profit for a SELL order must be below the execution price." });
      }
    }

    const units = size_usd / executionPrice;
    const tradeId = 'trd_' + Math.random().toString(36).substring(2, 11);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?`, [size_usd, account_id]);
      db.run(
        `INSERT INTO trades (id, account_id, symbol, side, entry_price, size_usd, units, sl, tp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
        [tradeId, account_id, symbol, side, executionPrice, size_usd, units, sl || null, tp || null],
        (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }
          db.run("COMMIT");
          res.json({ success: true, trade_id: tradeId, execution_price: executionPrice });
        }
      );
    });
  });
});

app.post('/api/trades/close', sensitiveLimiter, (req, res) => {
  const { trade_id, current_market_price } = req.body;
  if (!trade_id) return res.status(400).json({ error: "Trade ID required." });

  db.get("SELECT * FROM trades WHERE id = ? AND status = 'OPEN'", [trade_id], (err, trade) => {
    if (err || !trade) return res.status(404).json({ error: "Open trade not found." });

    const priceDiff = trade.side === 'BUY' ? (current_market_price - trade.entry_price) : (trade.entry_price - current_market_price);
    const pnl = priceDiff * trade.units;
    const returnAmount = trade.size_usd + pnl;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      db.run(`UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pnl, trade_id]);
      db.run(`UPDATE accounts SET current_balance = current_balance + ?, current_equity = current_equity + ? WHERE id = ?`, [returnAmount, pnl, trade.account_id]);
      db.run("COMMIT");
      res.json({ success: true, pnl: pnl });
    });
  });
});

app.get('/api/trades/active', (req, res) => {
  const accountId = req.query.account_id;
  if (!accountId) return res.status(400).json({ error: "Account ID required" });

  db.all("SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'", [accountId], (err, trades) => {
    res.json({ trades: trades || [] });
  });
});

app.listen(PORT, () => {
  console.log(`Blastrr server running on port ${PORT}`);
});

const SUPPORTED_EVM_CHAINS = {
    1: {
        name: "Ethereum Mainnet",
        chainIdHex: "0x1",
        rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/alch_2pR5KmvKvNRreMrrIahGw",
        usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        decimals: 6
    },
    8453: {
        name: "Base",
        chainIdHex: "0x2105",
        rpcUrl: "https://base-mainnet.g.alchemy.com/v2/alch_2pR5KmvKvNRreMrrIahGw",
        usdtAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // Bridged USDT on Base
        decimals: 6
    },
    137: {
        name: "Polygon PoS",
        chainIdHex: "0x89",
        rpcUrl: "https://polygon-mainnet.g.alchemy.com/v2/alch_2pR5KmvKvNRreMrrIahGw",
        usdtAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", // (PoS) Tether USD
        decimals: 6
    },
    43114: {
        name: "Avalanche C-Chain",
        chainIdHex: "0xa86a",
        rpcUrl: "https://avax-mainnet.g.alchemy.com/v2/alch_2pR5KmvKvNRreMrrIahGw",
        usdtAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", // Native/Standard USDT on Avalanche
        decimals: 6
    }
};
const { ethers } = require('ethers');

async function verifyMultiChainPurchase(txHash, chainId, expectedBuyerWallet, expectedAmountUsdt, treasuryWallet) {
    const chainConfig = SUPPORTED_EVM_CHAINS[chainId];
    if (!chainConfig) {
        return { success: false, error: "Unsupported blockchain network." };
    }

    try {
        // Connect to the specific Alchemy endpoint for this chain
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!tx || !receipt || receipt.status !== 1) {
            return { success: false, error: "Transaction not found or failed on-chain." };
        }

        // SECURITY CHECK: Mempool Snipe Protection
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
                const tokenValue = Number(rawValue) / Math.pow(10, chainConfig.decimals);

                if (recipient.toLowerCase() === treasuryWallet.toLowerCase() && tokenValue >= expectedAmountUsdt) {
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
