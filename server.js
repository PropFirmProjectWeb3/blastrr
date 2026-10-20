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

app.post('/api/promo/validate', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  db.get("SELECT * FROM users WHERE discount_code = ?", [code.toUpperCase()], (err, user) => {
    if (err || !user) return res.json({ valid: false, error: "Invalid promo code." });
    res.json({ valid: true, referrer_wallet: user.wallet_address, discount_pct: 90 });
  });
});

// Get all accounts for a wallet (unlimited support)
app.get('/api/accounts', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });

  db.all(
    `SELECT a.*, p.name as plan_name FROM accounts a 
     JOIN plans p ON a.plan_id = p.id 
     WHERE LOWER(a.wallet_address) = LOWER(?)`,
    [wallet],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ accounts: rows || [] });
    }
  );
});

// Purchase Plan (Allows multiple accounts per wallet)
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

app.post('/api/orders/place', (req, res) => {
  const { account_id, symbol, side, price, size, sl, tp } = req.body;
  
  if (!account_id || !symbol || !side || !price || !size) {
    return res.status(400).json({ error: "Missing required order parameters." });
  }

  const orderId = 'ord_' + Math.random().toString(36).substring(2, 11);

  db.run(
    `INSERT INTO orders (id, account_id, symbol, type, price, size, sl, tp, status)
     VALUES (?, ?, ?, 'LIMIT', ?, ?, ?, ?, 'PENDING')`,
    [orderId, account_id, symbol, price, size, sl || null, tp || null],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, order_id: orderId, message: "Limit order placed successfully." });
    }
  );
});

app.get('/api/trades/active', (req, res) => {
  const accountId = req.query.account_id;
  if (!accountId) return res.status(400).json({ error: "Account ID required" });

  db.all("SELECT * FROM orders WHERE account_id = ? AND status = 'PENDING'", [accountId], (err, orders) => {
    db.all("SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'", [accountId], (err2, trades) => {
      res.json({ orders: orders || [], trades: trades || [] });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Blastrr server running on port ${PORT}`);
});
