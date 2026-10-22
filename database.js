const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, 'blastrr.db');
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
      max_single_day_profit_pct REAL DEFAULT 40.0,
      active INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
      wallet_address TEXT PRIMARY KEY,
      role TEXT DEFAULT 'SUPER_ADMIN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS purchases (
      tx_hash TEXT PRIMARY KEY,
      chain_id INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      account_id TEXT NOT NULL,
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
      risk_day TEXT,
      status TEXT DEFAULT 'ACTIVE',
      lock_reason TEXT,
      locked_until TEXT,
      permanent_lock INTEGER DEFAULT 0,
      admin_frozen INTEGER DEFAULT 0,
      admin_freeze_reason TEXT,
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
      leverage INTEGER DEFAULT 1,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      wallet_address TEXT,
      amount REAL,
      status TEXT DEFAULT 'PENDING',
      type TEXT DEFAULT 'PROFIT_SPLIT',
      plan_name TEXT,
      user_ip TEXT,
      user_amount REAL,
      admin_share REAL,
      funds_deducted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_withdrawals (
      id TEXT PRIMARY KEY,
      wallet_address TEXT,
      amount REAL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    db.run(`CREATE TABLE IF NOT EXISTS daily_account_summaries (
      account_id TEXT NOT NULL,
      day TEXT NOT NULL,
      opening_balance REAL NOT NULL,
      closing_balance REAL NOT NULL,
      profit REAL NOT NULL,
      PRIMARY KEY (account_id, day),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.all("PRAGMA table_info(accounts)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect accounts schema', err.message);
        return;
      }
      const existing = new Set(columns.map(column => column.name));
      const additions = [
        ['lock_reason', 'TEXT'],
        ['locked_until', 'TEXT'],
        ['permanent_lock', 'INTEGER DEFAULT 0'],
        ['admin_frozen', 'INTEGER DEFAULT 0'],
        ['admin_freeze_reason', 'TEXT'],
        ['risk_day', 'TEXT']
      ].filter(([name]) => !existing.has(name));
      for (const [name, type] of additions) {
        db.run(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`, (alterErr) => {
          if (alterErr) console.error(`Unable to add accounts.${name}`, alterErr.message);
        });
      }
    });

    db.all("PRAGMA table_info(plans)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect plans schema', err.message);
        return;
      }
      if (!columns.some(column => column.name === 'active')) {
        db.run("ALTER TABLE plans ADD COLUMN active INTEGER DEFAULT 1", (alterErr) => {
          if (alterErr) console.error('Unable to add plans.active', alterErr.message);
        });
      }
    });

    db.all("PRAGMA table_info(trades)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect trades schema', err.message);
        return;
      }
      if (!columns.some(column => column.name === 'leverage')) {
        db.run("ALTER TABLE trades ADD COLUMN leverage INTEGER DEFAULT 1", (alterErr) => {
          if (alterErr) console.error('Unable to add trades.leverage', alterErr.message);
        });
      }
    });

    db.all("PRAGMA table_info(withdrawals)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect withdrawals schema', err.message);
        return;
      }
      const existing = new Set(columns.map(column => column.name));
      const additions = [
        ['type', "TEXT DEFAULT 'PROFIT_SPLIT'"],
        ['plan_name', 'TEXT'],
        ['user_ip', 'TEXT'],
        ['user_amount', 'REAL'],
        ['admin_share', 'REAL'],
        ['funds_deducted', 'INTEGER']
      ].filter(([name]) => !existing.has(name));
      const addNext = (index) => {
        if (index >= additions.length) {
          return db.run(
            `UPDATE withdrawals SET funds_deducted = 1
             WHERE status = 'PENDING' AND funds_deducted IS NULL`,
            (updateErr) => {
              if (updateErr) console.error('Unable to migrate legacy pending withdrawal balances', updateErr.message);
            }
          );
        }
        const [name, type] = additions[index];
        db.run(`ALTER TABLE withdrawals ADD COLUMN ${name} ${type}`, (alterErr) => {
          if (alterErr) {
            console.error(`Unable to add withdrawals.${name}`, alterErr.message);
            return addNext(index + 1);
          }
          addNext(index + 1);
        });
      }
      addNext(0);
    });
  });
}

module.exports = db;
