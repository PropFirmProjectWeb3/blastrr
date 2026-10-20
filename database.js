const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'blastrr.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run("PRAGMA journal_mode = WAL;");
    initTables();
  }
});

function initTables() {
  db.serialize(() => {
    // Users authenticated via Web3 wallet, storing custom username & unique promo code
    db.run(`CREATE TABLE IF NOT EXISTS users (
      wallet_address TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      discount_code TEXT UNIQUE,
      referred_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Evaluation Plans (10x Base Price / 90% Discounted Listed Price)
    db.run(`CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_price_usdt REAL NOT NULL,
      price_usdt REAL NOT NULL,
      simulated_capital REAL NOT NULL,
      profit_target REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      daily_loss_pct REAL NOT NULL,
      max_single_day_profit_pct REAL DEFAULT 40.0
    )`);

    // Designated Admin Wallets
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      wallet_address TEXT PRIMARY KEY,
      role TEXT DEFAULT 'SUPER_ADMIN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Simulated Trading Accounts (1 Active Account per Wallet Limit)
    db.run(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      wallet_address TEXT,
      plan_id INTEGER,
      initial_balance REAL,
      current_balance REAL,
      current_equity REAL,
      high_water_mark REAL,
      daily_starting_balance REAL,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wallet_address) REFERENCES users(wallet_address),
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    )`);

    // Orders (Limit, SL, TP)
    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      symbol TEXT,
      type TEXT,
      price REAL,
      size REAL,
      sl REAL,
      tp REAL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    // Executed Active Trades
    db.run(`CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      order_id TEXT,
      symbol TEXT,
      side TEXT,
      entry_price REAL,
      size REAL,
      sl REAL,
      tp REAL,
      pnl REAL DEFAULT 0,
      status TEXT DEFAULT 'OPEN',
      closed_at DATETIME,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    // Daily PnL Ledger for NY Time Consistency Audits
    db.run(`CREATE TABLE IF NOT EXISTS daily_pnl_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      ny_date TEXT NOT NULL,
      daily_profit REAL DEFAULT 0,
      daily_loss REAL DEFAULT 0,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      UNIQUE(account_id, ny_date)
    )`);

    // Payout Requests Queue
    db.run(`CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      requested_amount REAL NOT NULL,
      trader_share_amount REAL NOT NULL,
      platform_share_amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING',
      admin_notes TEXT,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    // Affiliate Earnings Ledger (2% Commission Tracking)
    db.run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_wallet TEXT,
      referee_wallet TEXT,
      plan_id INTEGER,
      paid_amount REAL,
      commission_earned REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Blacklisted Wallets
    db.run(`CREATE TABLE IF NOT EXISTS blacklisted_wallets (
      wallet_address TEXT PRIMARY KEY,
      reason TEXT,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Admin Audit Logs
    db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_wallet TEXT,
      action TEXT,
      target_account_id TEXT,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

module.exports = db;
