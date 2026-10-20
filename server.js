const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 4480;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function seedPlans() {
  db.get("SELECT COUNT(*) as count FROM plans", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO plans (name, base_price_usdt, price_usdt, simulated_capital, profit_target, max_drawdown_pct, daily_loss_pct, max_single_day_profit_pct) VALUES 
        ('Micro $5k', 500.00, 50.00, 5000, 1000, 10.0, 5.0, 40.0),
        ('Starter $10k', 1000.00, 100.00, 10000, 2000, 10.0, 5.0, 40.0),
        ('Trader $20k', 2000.00, 200.00, 20000, 4000, 10.0, 5.0, 40.0),
        ('Pro $50k', 5000.00, 500.00, 50000, 10000, 10.0, 5.0, 40.0),
        ('Elite $100k', 10000.00, 1000.00, 100000, 20000, 10.0, 5.0, 40.0),
        ('Whale $250k', 25000.00, 2500.00, 250000, 50000, 10.0, 5.0, 40.0)`);
      console.log("Blastrr 6-Tier evaluation plans successfully seeded.");
    }
  });
}

setTimeout(seedPlans, 1000);

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
        res.json({
          user: user || null,
          stats: stats[0] || { total_referrals: 0, total_earned: 0 }
        });
      }
    );
  });
});

app.post('/api/user/profile', (req, res) => {
  const { wallet_address, username, discount_code } = req.body;
  if (!wallet_address || !username || !discount_code) {
    return res.status(400).json({ error: "Username and promo code are required." });
  }

  db.run(
    `INSERT INTO users (wallet_address, username, discount_code) 
     VALUES (?, ?, ?)
     ON CONFLICT(wallet_address) DO UPDATE SET 
     username = excluded.username, 
     discount_code = excluded.discount_code`,
    [wallet_address, username.toLowerCase(), discount_code.toUpperCase()],
    (err) => {
      if (err) return res.status(400).json({ error: "Username or Promo Code already taken." });
      res.json({ success: true, message: "Profile updated successfully." });
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

app.post('/api/promo/validate', (req, res) => {
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

app.post('/api/accounts/purchase', (req, res) => {
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

// Withdrawal Requests
app.post('/api/withdrawals/request', (req, res) => {
  const { account_id, wallet_address, amount } = req.body;
  if (!account_id || !wallet_address || !amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid withdrawal parameters." });
  }

  db.get("SELECT * FROM accounts WHERE id = ? AND LOWER(wallet_address) = LOWER(?)", [account_id, wallet_address], (err, account) => {
    if (err || !account) return res.status(404).json({ error: "Account not found." });

    if (amount > account.current_balance) {
      return res.status(400).json({ error: `Requested amount ($${amount}) exceeds available balance ($${account.current_balance}).` });
    }

    const withdrawalId = 'wdr_' + Math.random().toString(36).substring(2, 11);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      // Deduct from current balance
      db.run("UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?", [amount, account_id]);

      // Insert withdrawal request
      db.run(
        `INSERT INTO withdrawals (id, account_id, wallet_address, amount, status) VALUES (?, ?, ?, ?, 'PENDING')`,
        [withdrawalId, account_id, wallet_address, amount],
        (err2) => {
          if (err2) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: err2.message });
          }
          db.run("COMMIT");
          res.json({ success: true, message: "Withdrawal request submitted successfully." });
        }
      );
    });
  });
});

// Admin endpoints for withdrawals
app.get('/api/admin/withdrawals', (req, res) => {
  db.all(
    `SELECT w.*, a.plan_id, p.name as plan_name 
     FROM withdrawals w 
     JOIN accounts a ON w.account_id = a.id 
     JOIN plans p ON a.plan_id = p.id 
     ORDER BY w.created_at DESC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ withdrawals: rows || [] });
    }
  );
});

app.post('/api/admin/withdrawals/action', (req, res) => {
  const { withdrawal_id, action } = req.body; // action: 'PAID' or 'REJECT'
  if (!withdrawal_id || !action) return res.status(400).json({ error: "Missing parameters." });

  db.get("SELECT * FROM withdrawals WHERE id = ?", [withdrawal_id], (err, wdr) => {
    if (err || !wdr) return res.status(404).json({ error: "Withdrawal request not found." });
    if (wdr.status !== 'PENDING') return res.status(400).json({ error: "Request already processed." });

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      if (action === 'REJECT') {
        // Refund balance back to account
        db.run("UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?", [wdr.amount, wdr.account_id]);
        db.run("UPDATE withdrawals SET status = 'REJECTED' WHERE id = ?", [withdrawal_id]);
      } else if (action === 'PAID') {
        db.run("UPDATE withdrawals SET status = 'PAID' WHERE id = ?", [withdrawal_id]);
      }

      db.run("COMMIT");
      res.json({ success: true, message: `Withdrawal marked as ${action}.` });
    });
  });
});

app.post('/api/trades/execute', (req, res) => {
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
    const units = size_usd / executionPrice;
    const tradeId = 'trd_' + Math.random().toString(36).substring(2, 11);

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        `UPDATE accounts SET current_balance = current_balance - ? WHERE id = ?`,
        [size_usd, account_id]
      );

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

app.post('/api/trades/close', (req, res) => {
  const { trade_id, current_market_price } = req.body;
  if (!trade_id) return res.status(400).json({ error: "Trade ID required." });

  db.get("SELECT * FROM trades WHERE id = ? AND status = 'OPEN'", [trade_id], (err, trade) => {
    if (err || !trade) return res.status(404).json({ error: "Open trade not found." });

    const priceDiff = trade.side === 'BUY' ? (current_market_price - trade.entry_price) : (trade.entry_price - current_market_price);
    const pnl = priceDiff * trade.units;
    const returnAmount = trade.size_usd + pnl;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      db.run(
        `UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [pnl, trade_id]
      );

      db.run(
        `UPDATE accounts SET current_balance = current_balance + ?, current_equity = current_equity + ? WHERE id = ?`,
        [returnAmount, pnl, trade.account_id]
      );

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
