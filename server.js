// Seed default plans if none exist
function seedPlans() {
  db.get("SELECT COUNT(*) as count FROM plans", (err, row) => {
    if (row.count === 0) {
      db.run(`INSERT INTO plans (name, price_usdt, simulated_capital, profit_target, max_drawdown_pct, daily_loss_pct, max_single_day_profit_pct) VALUES 
        ('Starter $10k', 50, 10000, 1000, 10.0, 5.0, 40.0),
        ('Pro $50k', 200, 50000, 5000, 10.0, 5.0, 40.0),
        ('Elite $100k', 350, 100000, 10000, 8.0, 4.0, 35.0)`);
      console.log("Default prop plans seeded.");
    }
  });
}
seedPlans();

// Endpoint: Get all active plans
app.get('/api/plans', (req, res) => {
  db.all("SELECT * FROM plans", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ plans: rows });
  });
});

// Endpoint: Get user's active accounts
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
      res.json({ accounts: rows });
    }
  );
});

// Endpoint: Purchase a plan & provision a simulated account
app.post('/api/accounts/purchase', (req, res) => {
  const { wallet_address, plan_id } = req.body;
  if (!wallet_address || !plan_id) {
    return res.status(400).json({ error: "Wallet address and plan ID required" });
  }

  // 1. Get plan details
  db.get("SELECT * FROM plans WHERE id = ?", [plan_id], (err, plan) => {
    if (err || !plan) return res.status(404).json({ error: "Plan not found" });

    // 2. Ensure user exists
    db.run("INSERT OR IGNORE INTO users (wallet_address) VALUES (?)", [wallet_address], () => {
      
      // 3. Generate unique account ID (UUID-like)
      const accountId = 'acc_' + Math.random().toString(36).substring(2, 11);
      const initialCapital = plan.simulated_capital;

      // 4. Insert new simulated account
      db.run(
        `INSERT INTO accounts (id, wallet_address, plan_id, initial_balance, current_balance, current_equity, high_water_mark, daily_starting_balance, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [accountId, wallet_address, plan_id, initialCapital, initialCapital, initialCapital, initialCapital, initialCapital],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true, account_id: accountId, message: "Simulated account successfully provisioned!" });
        }
      );
    });
  });
});
