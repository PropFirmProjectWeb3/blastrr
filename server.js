// Endpoint: Get active account for a wallet (Enforcing 1 active account rule)
app.get('/api/accounts/active', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.status(400).json({ error: "Wallet required" });

  db.get(
    `SELECT a.*, p.name as plan_name FROM accounts a 
     JOIN plans p ON a.plan_id = p.id 
     WHERE LOWER(a.wallet_address) = LOWER(?) AND a.status = 'ACTIVE' 
     LIMIT 1`,
    [wallet],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ account: row || null });
    }
  );
});

// Endpoint: Place a new limit order
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

// Endpoint: Get open orders and trades for an account
app.get('/api/trades/active', (req, res) => {
  const accountId = req.query.account_id;
  if (!accountId) return res.status(400).json({ error: "Account ID required" });

  db.all("SELECT * FROM orders WHERE account_id = ? AND status = 'PENDING'", [accountId], (err, orders) => {
    db.all("SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'", [accountId], (err2, trades) => {
      res.json({ orders, trades });
    });
  });
});
