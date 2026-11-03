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
      referral_pct REAL NOT NULL DEFAULT 2,
      referred_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS creator_applications (
      wallet_address TEXT PRIMARY KEY,
      x_url TEXT,
      youtube_url TEXT,
      tiktok_url TEXT,
      instagram_url TEXT,
      twitch_url TEXT,
      discord_url TEXT,
      website_url TEXT,
      community_size TEXT NOT NULL,
      community_description TEXT NOT NULL,
      creator_motivation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
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

    db.run(`CREATE TABLE IF NOT EXISTS wallet_disclaimer_acceptances (
      wallet_address TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (wallet_address, version)
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
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_withdrawals (
      id TEXT PRIMARY KEY,
      wallet_address TEXT,
      amount REAL,
      status TEXT DEFAULT 'PENDING',
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_wallet TEXT,
      referee_wallet TEXT,
      plan_id INTEGER,
      paid_amount REAL,
      commission_earned REAL,
      commission_pct REAL DEFAULT 2,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      plan_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      standard_discount_pct REAL NOT NULL DEFAULT 90
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_plan_rewards (
      plan_id INTEGER PRIMARY KEY,
      xp_reward INTEGER NOT NULL DEFAULT 1000,
      points_reward INTEGER NOT NULL DEFAULT 100,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_users (
      wallet_address TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      profile_image_url TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_levels (
      level INTEGER PRIMARY KEY CHECK(level BETWEEN 1 AND 12),
      xp_required INTEGER NOT NULL UNIQUE,
      discount_bonus_pct REAL NOT NULL DEFAULT 0,
      points_cost INTEGER NOT NULL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      action_url TEXT NOT NULL DEFAULT 'https://x.com/',
      task_type TEXT NOT NULL DEFAULT 'SOCIAL_CLICK' CHECK(task_type IN ('SOCIAL_CLICK', 'GREEN_DAY', 'GREEN_WEEK', 'TRADE_DAY', 'WITHDRAWAL')),
      cadence TEXT NOT NULL DEFAULT 'DAILY' CHECK(cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')),
      xp_reward INTEGER NOT NULL,
      points_reward INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_task_claims (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      cadence TEXT NOT NULL CHECK(cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')),
      period_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(wallet_address, task_id, cadence, period_key),
      FOREIGN KEY(task_id) REFERENCES battlepass_tasks(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_events (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      event_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      xp INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_type, reference_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS battlepass_reward_codes (
      code TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      level INTEGER NOT NULL,
      discount_bonus_pct REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      redeemed_at DATETIME,
      UNIQUE(wallet_address, level),
      FOREIGN KEY(level) REFERENCES battlepass_levels(level)
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

    db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      account_id TEXT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      author_role TEXT NOT NULL CHECK(author_role IN ('USER', 'ADMIN')),
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_reviews (
      account_id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      username TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    )`);

    db.run('CREATE INDEX IF NOT EXISTS idx_support_tickets_wallet_updated ON support_tickets(wallet_address, updated_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated ON support_tickets(status, updated_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id, created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_promo_codes_created_at ON promo_codes(created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_battlepass_claims_wallet ON battlepass_task_claims(wallet_address, created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_battlepass_events_wallet ON battlepass_events(wallet_address, created_at DESC)');

    db.run(
      'INSERT OR IGNORE INTO battlepass_settings (id, standard_discount_pct) VALUES (1, 90)'
    );
    for (let level = 1; level <= 12; level++) {
      db.run(
        'INSERT OR IGNORE INTO battlepass_levels (level, xp_required, discount_bonus_pct, points_cost) VALUES (?, ?, ?, ?)',
        [level, level * 10000, level, level * 100]
      );
    }
    db.all("PRAGMA table_info(battlepass_tasks)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect battlepass_tasks schema', err.message);
        return;
      }
      const requiredColumns = [
        ['cadence', "ALTER TABLE battlepass_tasks ADD COLUMN cadence TEXT NOT NULL DEFAULT 'DAILY'"],
        ['action_url', "ALTER TABLE battlepass_tasks ADD COLUMN action_url TEXT NOT NULL DEFAULT 'https://x.com/'"],
        ['task_type', "ALTER TABLE battlepass_tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'SOCIAL_CLICK'"],
        ['is_builtin', 'ALTER TABLE battlepass_tasks ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0']
      ];
      const addMissingColumns = (index) => {
        if (index >= requiredColumns.length) return migrateTaskTypeConstraint();
        const [name, sql] = requiredColumns[index];
        if (columns.some(column => column.name === name)) return addMissingColumns(index + 1);
        db.run(sql, alterErr => {
          if (alterErr) {
            console.error(`Unable to add battlepass_tasks.${name}`, alterErr.message);
            return;
          }
          addMissingColumns(index + 1);
        });
      };
      const seedTasks = () => db.run(
        `UPDATE battlepass_tasks SET is_builtin = 1
         WHERE task_type IN ('GREEN_DAY', 'GREEN_WEEK', 'TRADE_DAY')`,
        markErr => {
          if (markErr) {
            console.error('Unable to mark built-in battle pass tasks', markErr.message);
            return;
          }
          const defaults = [
            ['Green day', 'Finish the previous UTC day with positive realized trading profit. Claim after the day closes.', 'GREEN_DAY', 'DAILY', 500, 50],
            ['Green week', 'Finish the previous UTC week with positive realized trading profit. Claim after the week closes.', 'GREEN_WEEK', 'WEEKLY', 2500, 250],
            ['Trade each day', 'Close at least one trade during the current UTC day.', 'TRADE_DAY', 'DAILY', 100, 10],
            ['Paid withdrawal', 'Claim after a withdrawal is marked paid during this UTC day.', 'WITHDRAWAL', 'DAILY', 500, 50]
          ];
          const seedNext = index => {
            if (index >= defaults.length) return;
            const [title, description, taskType, cadence, xpReward, pointsReward] = defaults[index];
            db.run(
              `INSERT INTO battlepass_tasks
               (title, description, task_type, cadence, xp_reward, points_reward, is_builtin)
               SELECT ?, ?, ?, ?, ?, ?, 1
               WHERE NOT EXISTS (
                 SELECT 1 FROM battlepass_tasks WHERE is_builtin = 1 AND task_type = ?
               )`,
              [title, description, taskType, cadence, xpReward, pointsReward, taskType],
              seedErr => {
                if (seedErr) {
                  console.error(`Unable to seed the built-in ${taskType} task`, seedErr.message);
                  return;
                }
                seedNext(index + 1);
              }
            );
          };
          seedNext(0);
        }
      );
      const migrateTaskTypeConstraint = () => db.get(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'battlepass_tasks'",
        [],
        (schemaErr, schema) => {
          if (schemaErr || !schema?.sql) {
            console.error('Unable to inspect battlepass_tasks constraints', schemaErr?.message || 'Table definition not found.');
            return;
          }
          if (schema.sql.includes("'TRADE_DAY'")) return seedTasks();
          db.run('PRAGMA foreign_keys = OFF', pragmaErr => {
            if (pragmaErr) {
              console.error('Unable to prepare battlepass task migration', pragmaErr.message);
              return;
            }
            db.run('BEGIN IMMEDIATE', beginErr => {
              if (beginErr) {
                console.error('Unable to start battlepass task migration', beginErr.message);
                db.run('PRAGMA foreign_keys = ON');
                return;
              }
              const steps = [
                `CREATE TABLE battlepass_tasks_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  description TEXT NOT NULL,
                  action_url TEXT NOT NULL DEFAULT 'https://x.com/',
                  task_type TEXT NOT NULL DEFAULT 'SOCIAL_CLICK' CHECK(task_type IN ('SOCIAL_CLICK', 'GREEN_DAY', 'GREEN_WEEK', 'TRADE_DAY', 'WITHDRAWAL')),
                  cadence TEXT NOT NULL DEFAULT 'DAILY' CHECK(cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')),
                  xp_reward INTEGER NOT NULL,
                  points_reward INTEGER NOT NULL,
                  active INTEGER NOT NULL DEFAULT 1,
                  is_builtin INTEGER NOT NULL DEFAULT 0,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`,
                `INSERT INTO battlepass_tasks_new
                 (id, title, description, action_url, task_type, cadence, xp_reward, points_reward, active, is_builtin, created_at)
                 SELECT id, title, description, action_url, task_type, cadence, xp_reward, points_reward, active, is_builtin, created_at
                 FROM battlepass_tasks`,
                'DROP TABLE battlepass_tasks',
                'ALTER TABLE battlepass_tasks_new RENAME TO battlepass_tasks'
              ];
              const runMigrationStep = index => {
                if (index >= steps.length) {
                  return db.run('COMMIT', commitErr => {
                    if (commitErr) {
                      console.error('Unable to complete battlepass task migration', commitErr.message);
                      db.run('ROLLBACK', () => db.run('PRAGMA foreign_keys = ON'));
                      return;
                    }
                    db.run('PRAGMA foreign_keys = ON', foreignKeysErr => {
                      if (foreignKeysErr) console.error('Unable to restore database foreign key checks', foreignKeysErr.message);
                      seedTasks();
                    });
                  });
                }
                db.run(steps[index], stepErr => {
                  if (stepErr) {
                    console.error('Unable to migrate battlepass task type constraint', stepErr.message);
                    return db.run('ROLLBACK', () => db.run('PRAGMA foreign_keys = ON'));
                  }
                  runMigrationStep(index + 1);
                });
              };
              runMigrationStep(0);
            });
          });
        }
      );
      addMissingColumns(0);
    });

    db.all("PRAGMA table_info(users)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect users schema', err.message);
        return;
      }
      if (!columns.some(column => column.name === 'referral_pct')) {
        db.run('ALTER TABLE users ADD COLUMN referral_pct REAL NOT NULL DEFAULT 2', (alterErr) => {
          if (alterErr) console.error('Unable to add users.referral_pct', alterErr.message);
        });
      }
    });

    db.all("PRAGMA table_info(referrals)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect referrals schema', err.message);
        return;
      }
      if (!columns.some(column => column.name === 'commission_pct')) {
        db.run('ALTER TABLE referrals ADD COLUMN commission_pct REAL DEFAULT 2', (alterErr) => {
          if (alterErr) console.error('Unable to add referrals.commission_pct', alterErr.message);
        });
      }
    });

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

      db.all("PRAGMA table_info(user_reviews)", (err, columns) => {
        if (err) {
          console.error('Unable to inspect user_reviews schema', err.message);
          return;
        }
        if (columns.some(column => column.name === 'account_id')) {
          db.run('CREATE INDEX IF NOT EXISTS idx_user_reviews_published_updated ON user_reviews(published, updated_at DESC)', (indexErr) => {
            if (indexErr) console.error('Unable to index user reviews', indexErr.message);
          });
          return;
        }

        db.serialize(() => {
          db.run('BEGIN IMMEDIATE', (beginErr) => {
            if (beginErr) {
              console.error('Unable to start user review migration', beginErr.message);
              return;
            }
            const rollback = (label, migrationErr) => db.run('ROLLBACK', () => {
              console.error(label, migrationErr?.message || 'Migration rolled back.');
            });
            db.run('ALTER TABLE user_reviews RENAME TO user_reviews_legacy', (renameErr) => {
              if (renameErr) return rollback('Unable to prepare user review migration', renameErr);
              db.run(`CREATE TABLE user_reviews (
                account_id TEXT PRIMARY KEY,
                wallet_address TEXT NOT NULL,
                username TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                comment TEXT NOT NULL,
                published INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(account_id) REFERENCES accounts(id)
              )`, (createErr) => {
                if (createErr) return rollback('Unable to create account-linked reviews table', createErr);
                db.run(`INSERT INTO user_reviews (account_id, wallet_address, username, rating, comment, published, created_at, updated_at)
                  SELECT (SELECT a.id FROM accounts a
                          JOIN purchases p ON p.account_id = a.id
                            AND LOWER(p.wallet_address) = LOWER(a.wallet_address)
                          WHERE LOWER(a.wallet_address) = LOWER(old.wallet_address)
                          ORDER BY a.created_at, a.id LIMIT 1),
                         old.wallet_address, old.username, old.rating, old.comment, old.published, old.created_at, old.updated_at
                  FROM user_reviews_legacy old
                  WHERE EXISTS (
                    SELECT 1 FROM accounts a
                    JOIN purchases p ON p.account_id = a.id
                      AND LOWER(p.wallet_address) = LOWER(a.wallet_address)
                    WHERE LOWER(a.wallet_address) = LOWER(old.wallet_address)
                  )`,
                (copyErr) => {
                  if (copyErr) return rollback('Unable to migrate existing account reviews', copyErr);
                  db.run('DROP TABLE user_reviews_legacy', (dropErr) => {
                    if (dropErr) return rollback('Unable to finish user review migration', dropErr);
                    db.run('CREATE INDEX IF NOT EXISTS idx_user_reviews_published_updated ON user_reviews(published, updated_at DESC)', (indexErr) => {
                      if (indexErr) return rollback('Unable to index migrated user reviews', indexErr);
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) return rollback('Unable to commit user review migration', commitErr);
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
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
        ['funds_deducted', 'INTEGER'],
        ['paid_at', 'DATETIME']
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

    db.all("PRAGMA table_info(referral_withdrawals)", (err, columns) => {
      if (err) {
        console.error('Unable to inspect referral_withdrawals schema', err.message);
        return;
      }
      if (columns.some(column => column.name === 'paid_at')) return;
      db.run('ALTER TABLE referral_withdrawals ADD COLUMN paid_at DATETIME', alterErr => {
        if (alterErr) console.error('Unable to add referral_withdrawals.paid_at', alterErr.message);
      });
    });
  });
}

module.exports = db;
