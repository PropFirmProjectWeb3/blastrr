const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 4480;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: Check Wallet Blacklist
async function checkBlacklist(req, res, next) {
  const walletAddress = req.body?.wallet_address || req.query?.wallet;
  if (walletAddress) {
    db.get(
      "SELECT 1 FROM blacklisted_wallets WHERE LOWER(wallet_address) = LOWER(?)",
      [walletAddress],
      (err, row) => {
        if (row) {
          return res.status(403).json({ error: "ACCESS_DENIED", message: "Wallet is permanently banned." });
        }
        next();
      }
    );
  } else {
    next();
  }
}

app.use(checkBlacklist);

// Endpoint: Check User Role (Admin vs Trader)
app.get('/api/auth/role', (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet) return res.json({ isAdmin: false });

  db.get("SELECT role FROM admins WHERE LOWER(wallet_address) = LOWER(?)", [wallet], (err, row) => {
    if (row) {
      res.json({ isAdmin: true, role: row.role });
    } else {
      res.json({ isAdmin: false });
    }
  });
});

// Endpoint: Get Plans
app.get('/api/plans', (req, res) => {
  db.all("SELECT * FROM plans", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ plans: rows });
  });
});

app.listen(PORT, () => {
  console.log(`Blastrr server running on port ${PORT}`);
});
