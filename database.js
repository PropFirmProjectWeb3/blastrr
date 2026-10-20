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
    db.run(`CREATE TABLE IF NOT EXISTS users (
      wallet_address TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      discount_code TEXT UNIQUE,
      referred_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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

    db.run(`CREATE TABLE IF NOT EXISTS admins (
      wallet_address TEXT PRIMARY KEY,
      role TEXT DEFAULT 'SUPER_ADMIN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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

    db.run(`CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      symbol TEXT,
      side TEXT,
      entry_price REAL,
      size_usd REAL,
      units REAL,
      sl REAL,
      tp REAL,
      pnl REAL DEFAULT 0,
      status TEXT DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      wallet_address TEXT,
      amount REAL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_wallet TEXT,
      referee_wallet TEXT,
      plan_id INTEGER,
      paid_amount REAL,
      commission_earned REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}

module.exports = db;
