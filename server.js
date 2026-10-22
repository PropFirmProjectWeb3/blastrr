const express = require('express');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { ethers } = require('ethers');
const db = require('./database');
const defaultPlans = require('./config/plans.json');
const markets = require('./public/config/markets.json');
const { getActiveLock, getRiskBreach } = require('./riskRules');

const app = express();
const PORT = process.env.PORT || 4480;

const TREASURY_WALLET = '0x8632fa855d5dc6b59a3cf892d72cf4a94f182aae';

// --- SUPPORTED EVM CHAINS CONFIGURATION ---
const SUPPORTED_EVM_CHAINS = {
    1: {
        name: "Ethereum Mainnet",
        chainIdHex: "0x1",
        rpcUrl: process.env.ETHEREUM_RPC_URL || "https://ethereum-rpc.publicnode.com",
        usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        decimals: 6
    },
    8453: {
        name: "Base",
        chainIdHex: "0x2105",
        rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        usdtAddress: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
        decimals: 6
    },
    137: {
        name: "Polygon PoS",
        chainIdHex: "0x89",
        rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
        usdtAddress: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",
        decimals: 6
    },
    43114: {
        name: "Avalanche C-Chain",
        chainIdHex: "0xa86a",
        rpcUrl: process.env.AVALANCHE_RPC_URL || "https://avalanche-c-chain-rpc.publicnode.com",
        usdtAddress: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7",
        decimals: 6
    },
    448000: {
        name: "NullNet Private EVM",
        chainIdHex: "0x6d5e0", // Hex for 448000
        rpcUrl: "https://terminull.lunul.org", // Update with your actual Geth RPC endpoint/proxy
        usdtAddress: "0x7ec3659A8225ED474D7c662126616aE08545C29b", // Your deployed contract address
        decimals: 6
    }
};

// --- 1. PROXY TRUST CONFIGURATION ---
app.set('trust proxy', 'loopback');

app.use(express.json({ limit: '32kb' }));
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

const sensitiveLimiter = createRateLimiter(30, 60000);

function seedPlans() {
  const syncNextPlan = (index) => {
    if (index === defaultPlans.length) {
      console.log(`Synchronized ${defaultPlans.length} plan definitions from config/plans.json.`);
      return;
    }
    const plan = defaultPlans[index];
    db.get("SELECT id FROM plans WHERE name = ? ORDER BY id LIMIT 1", [plan.name], (lookupErr, existing) => {
      if (lookupErr) return console.error('Unable to look up configured plan', lookupErr.message);
      const values = [
        plan.base_price_usdt,
        plan.price_usdt,
        plan.simulated_capital,
        plan.profit_target,
        plan.max_drawdown_pct,
        plan.daily_loss_pct,
        plan.max_single_day_profit_pct
      ];
      if (existing) {
        db.run(
          `UPDATE plans SET base_price_usdt = ?, price_usdt = ?, simulated_capital = ?,
           profit_target = ?, max_drawdown_pct = ?, daily_loss_pct = ?, max_single_day_profit_pct = ?, active = 1
           WHERE id = ?`,
          [...values, existing.id],
          (updateErr) => {
            if (updateErr) return console.error(`Unable to sync plan ${plan.name}`, updateErr.message);
            syncNextPlan(index + 1);
          }
        );
        return;
      }
      db.run(
        `INSERT INTO plans (name, base_price_usdt, price_usdt, simulated_capital, profit_target,
         max_drawdown_pct, daily_loss_pct, max_single_day_profit_pct, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [plan.name, ...values],
        (insertErr) => {
          if (insertErr) return console.error(`Unable to seed plan ${plan.name}`, insertErr.message);
          syncNextPlan(index + 1);
        }
      );
    });
  };
  db.run('UPDATE plans SET active = 0', (deactivateErr) => {
    if (deactivateErr) return console.error('Unable to retire unconfigured plans', deactivateErr.message);
    syncNextPlan(0);
  });
}

setTimeout(seedPlans, 1000);

const tradeChallenges = new Map();
const walletSessions = new Map();
const WALLET_SESSION_DURATION_MS = 15 * 60 * 1000;

function getAuthoritativePrice(market) {
  if (market.source === 'SIMULATED') {
    const wave = Math.sin(Date.now() / 2000) * market.amplitude;
    return Promise.resolve(Number((market.base + wave).toFixed(2)));
  }
  if (!['BINANCE_SPOT', 'BINANCE_PERP'].includes(market.source)) {
    return Promise.reject(new Error(`Unsupported market source: ${market.source}`));
  }

  const baseUrl = market.source === 'BINANCE_PERP'
    ? 'https://fapi.binance.com/fapi/v1/ticker/price'
    : 'https://api.binance.com/api/v3/ticker/price';
  const url = `${baseUrl}?symbol=${encodeURIComponent(market.pair)}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Market provider returned HTTP ${response.statusCode}.`));
        try {
          const parsed = JSON.parse(body);
          const price = Number(parsed.price);
          if (!Number.isFinite(price) || price <= 0) return reject(new Error('Market provider returned an invalid price.'));
          resolve(price);
        } catch (error) {
          reject(new Error(`Unable to parse market provider response: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Market price request timed out.')));
    request.on('error', reject);
  });
}

function requireTradeSignature(req, res, next) {
  const { wallet_address: wallet, signature, challenge } = req.body;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) ||
      typeof signature !== 'string' || typeof challenge !== 'string') {
    return res.status(401).json({ error: 'A signed wallet challenge is required.' });
  }

  const key = wallet.toLowerCase();
  const stored = tradeChallenges.get(challenge);
  tradeChallenges.delete(challenge);
  if (!stored || stored.walletAddress !== key || stored.expiresAt <= Date.now()) {
    return res.status(401).json({ error: 'Wallet challenge expired or already used.' });
  }

  try {
    if (ethers.verifyMessage(stored.message, signature).toLowerCase() !== key) {
      return res.status(401).json({ error: 'Wallet signature does not match.' });
    }
  } catch {
    return res.status(401).json({ error: 'Wallet signature is invalid.' });
  }
  next();
}

function requireWalletSession(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
  const session = match && walletSessions.get(match[1]);
  if (!session || session.expiresAt <= Date.now()) {
    if (match) walletSessions.delete(match[1]);
    return res.status(401).json({ error: 'A valid wallet session is required.' });
  }
  req.walletAddress = session.walletAddress;
  next();
}

function lockAccount(accountId, breach, callback) {
  const status = breach.permanent ? 'PERMANENTLY_LOCKED' : 'LOCKED';
  db.run(
    `UPDATE accounts SET status = ?, lock_reason = ?, locked_until = ?, permanent_lock = ?
     WHERE id = ?`,
    [status, breach.reason, breach.lockedUntil, breach.permanent ? 1 : 0, accountId],
    callback
  );
}

function unlockExpiredAccount(account, callback) {
  const lock = getActiveLock(account);
  if (lock) return callback(null, lock);
  if (account.lock_reason === 'DLL') {
    return db.run(
      `UPDATE accounts SET status = 'ACTIVE', daily_starting_balance = current_equity,
       lock_reason = NULL, locked_until = NULL
       WHERE id = ? AND permanent_lock = 0`,
      [account.id],
      (err) => {
        if (!err) {
          account.status = 'ACTIVE';
          account.daily_starting_balance = account.current_equity;
          account.lock_reason = null;
          account.locked_until = null;
        }
        callback(err, null);
      }
    );
  }
  callback(null, null);
}

function requireAdminWallet(req, res, next) {
  const wallet = req.body?.wallet_address;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return res.status(401).json({ error: 'Administrator wallet is required.' });
  }
  db.get(
    "SELECT role FROM admins WHERE LOWER(wallet_address) = LOWER(?)",
    [wallet],
    (err, admin) => {
      if (err) return res.status(500).json({ error: 'Unable to verify administrator role.' });
      if (!admin || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
        return res.status(403).json({ error: 'Administrator access required.' });
      }
      next();
    }
  );
}

// --- ON-CHAIN SECURE VERIFICATION FUNCTION ---
async function verifyMultiChainPurchase(txHash, chainId, expectedBuyerWallet, expectedAmountUsdt, treasuryWallet) {
    const chainConfig = SUPPORTED_EVM_CHAINS[chainId];
    if (!chainConfig) {
        return { success: false, error: "Unsupported blockchain network." };
    }

    try {
        const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!tx || !receipt || receipt.status !== 1) {
            return { success: false, error: "Transaction not found or failed on-chain." };
        }

        // SECURITY CHECK: Mempool Snipe Protection (tx.from must match buyer)
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

// --- API ROUTES ---

app.post('/api/auth/trade-challenge', sensitiveLimiter, (req, res) => {
  const wallet = req.body?.wallet_address;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet)) {
    return res.status(400).json({ error: 'A valid wallet address is required.' });
  }

  const key = wallet.toLowerCase();
  const now = Date.now();
  for (const [challengeWallet, challenge] of tradeChallenges) {
    if (challenge.expiresAt <= now) tradeChallenges.delete(challengeWallet);
  }
  if (tradeChallenges.size >= 5000) {
    return res.status(503).json({ error: 'Wallet authorization is temporarily unavailable.' });
  }

  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = now + 2 * 60 * 1000;
  const message = `Blastrr trade authorization\nWallet: ${key}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
  tradeChallenges.set(message, { walletAddress: key, expiresAt });
  res.json({ challenge: message });
});

app.post('/api/auth/wallet-session', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const now = Date.now();
  for (const [token, session] of walletSessions) {
    if (session.expiresAt <= now) walletSessions.delete(token);
  }
  if (walletSessions.size >= 5000) {
    return res.status(503).json({ error: 'Wallet sessions are temporarily unavailable.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + WALLET_SESSION_DURATION_MS;
  walletSessions.set(token, { walletAddress: req.body.wallet_address.toLowerCase(), expiresAt });
  res.json({ token, expires_at: expiresAt });
});

app.get('/api/plans', (req, res) => {
  db.all("SELECT * FROM plans WHERE active = 1 ORDER BY id", [], (err, rows) => {
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

app.get('/api/user/profile', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested profile.' });
  }

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

app.post('/api/user/profile', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { wallet_address, username, discount_code } = req.body;
  if (typeof username !== 'string' || typeof discount_code !== 'string') {
    return res.status(400).json({ error: "Username and promo code are required." });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanCode = discount_code.trim().toUpperCase();
  if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername) || !/^[A-Z0-9_-]{4,20}$/.test(cleanCode)) {
    return res.status(400).json({ error: "Username must be 3-24 letters, numbers, or underscores; promo codes must be 4-20 letters, numbers, underscores, or hyphens." });
  }

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

app.get('/api/user/referrals', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested referrals.' });
  }

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

app.post('/api/referrals/withdraw', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { wallet_address, amount } = req.body;
  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    return res.status(400).json({ error: "Invalid withdrawal parameters." });
  }

  const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return res.status(500).json({ error: 'Unable to start commission withdrawal.' });
      db.get(
        `SELECT COALESCE(SUM(commission_earned), 0) AS total_earned
         FROM referrals WHERE LOWER(referrer_wallet) = LOWER(?)`,
        [wallet_address],
        (earnedErr, earnedRow) => {
          if (earnedErr) return rollback(500, 'Unable to calculate commission balance.');
          db.get(
            `SELECT COALESCE(SUM(amount), 0) AS total_withdrawn
             FROM referral_withdrawals WHERE LOWER(wallet_address) = LOWER(?) AND status != 'REJECTED'`,
            [wallet_address],
            (withdrawnErr, withdrawnRow) => {
              if (withdrawnErr) return rollback(500, 'Unable to check prior commission withdrawals.');
              const available = Number(earnedRow.total_earned) - Number(withdrawnRow.total_withdrawn);
              if (amountValue > available) {
                return rollback(400, `Requested amount ($${amountValue}) exceeds available commission balance ($${available.toFixed(2)}).`);
              }

              const withdrawalId = `refw_${crypto.randomBytes(7).toString('hex')}`;
              db.run(
                `INSERT INTO referral_withdrawals (id, wallet_address, amount, status)
                 VALUES (?, ?, ?, 'PENDING')`,
                [withdrawalId, wallet_address, amountValue],
                (insertErr) => {
                  if (insertErr) return rollback(500, 'Unable to record commission withdrawal.');
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) return rollback(500, 'Unable to commit commission withdrawal.');
                    res.json({ success: true, message: 'Commission withdrawal requested successfully.' });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

app.post('/api/promo/validate', sensitiveLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  db.get("SELECT * FROM users WHERE discount_code = ?", [code.toUpperCase()], (err, user) => {
    if (err || !user) return res.json({ valid: false, error: "Invalid promo code." });
    res.json({ valid: true, referrer_wallet: user.wallet_address, discount_pct: 90 });
  });
});

app.get('/api/accounts', requireWalletSession, (req, res) => {
  const wallet = req.query.wallet;
  if (typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested accounts.' });
  }

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

app.get('/api/accounts/details', requireWalletSession, (req, res) => {
  const accountId = req.query.account_id;
  const wallet = req.query.wallet;
  if (!accountId || typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested account.' });
  }

  db.get(
    `SELECT a.*, p.name as plan_name, p.profit_target, p.max_drawdown_pct, p.daily_loss_pct, p.simulated_capital 
     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
    [accountId],
    (err, account) => {
      if (err) return res.status(500).json({ error: 'Unable to load account.' });
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ error: 'Wallet does not own this account.' });
      }

      unlockExpiredAccount(account, (unlockErr, activeLock) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        db.all(`SELECT * FROM trades WHERE account_id = ? ORDER BY created_at DESC`, [accountId], (err2, trades) => {
        if (err2) return res.status(500).json({ error: 'Unable to load account trades.' });
        const totalProfit = account.current_equity - account.initial_balance;
        const profitProgress = Math.min(100, Math.max(0, (totalProfit / account.profit_target) * 100));
        
        const maxAllowedDD = account.initial_balance * (account.max_drawdown_pct / 100);
        const currentDD = Math.max(0, account.initial_balance - account.current_equity);
        const ddProgress = Math.min(100, Math.max(0, (currentDD / maxAllowedDD) * 100));

        const maxAllowedDLL = account.daily_starting_balance * (account.daily_loss_pct / 100);
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
          lock: activeLock,
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
      });
    }
  );
});

// --- SECURE PURCHASE ENDPOINT (WITH MULTI-CHAIN ON-CHAIN VERIFICATION) ---
app.post('/api/accounts/purchase', sensitiveLimiter, async (req, res) => {
  const { wallet_address, plan_id, tx_hash, chain_id, promo_code } = req.body;

  if (typeof wallet_address !== 'string' || !ethers.isAddress(wallet_address) ||
      !Number.isInteger(Number(plan_id)) || Number(plan_id) <= 0 ||
      typeof tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash) ||
      !Number.isInteger(Number(chain_id)) ||
      (promo_code != null && (typeof promo_code !== 'string' || promo_code.length > 32))) {
    return res.status(400).json({ error: "Missing required purchase parameters." });
  }

  db.run(`INSERT OR IGNORE INTO users (wallet_address) VALUES (?)`, [wallet_address], (userErr) => {
    if (userErr) return res.status(500).json({ error: 'Unable to prepare the purchasing account.' });
    db.get("SELECT * FROM plans WHERE id = ? AND active = 1", [Number(plan_id)], async (err, plan) => {
      if (err || !plan) return res.status(404).json({ error: "Plan not found." });

      let finalPrice = plan.base_price_usdt;
      let referrerWallet = null;

      if (promo_code) {
        const referrer = await new Promise((resolve) => {
          db.get("SELECT * FROM users WHERE discount_code = ?", [promo_code.toUpperCase()], (e, r) => resolve(r));
        });
        if (referrer) {
          referrerWallet = referrer.wallet_address;
          finalPrice = plan.price_usdt;
        }
      }

      // --- SECURE ON-CHAIN VERIFICATION ---
      const verification = await verifyMultiChainPurchase(
          tx_hash,
          Number(chain_id),
          wallet_address,
          finalPrice,
          TREASURY_WALLET
      );

      if (!verification.success) {
          return res.status(400).json({ error: verification.error });
      }

      // --- PROVISION ACCOUNT ---
      const accountId = `acc_${crypto.randomBytes(8).toString('hex')}`;
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');
        db.run(
          `INSERT INTO purchases (tx_hash, chain_id, wallet_address, account_id)
           VALUES (?, ?, ?, ?)`,
          [tx_hash.toLowerCase(), Number(chain_id), wallet_address, accountId],
          (purchaseErr) => {
            if (purchaseErr) {
              return db.run('ROLLBACK', () => res.status(409).json({ error: 'This transaction has already been used or could not be recorded.' }));
            }
            db.run(
              `INSERT INTO accounts (id, wallet_address, plan_id, initial_balance, current_balance, current_equity, high_water_mark, daily_starting_balance, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
              [accountId, wallet_address, Number(plan_id), plan.simulated_capital, plan.simulated_capital, plan.simulated_capital, plan.simulated_capital, plan.simulated_capital],
              (accountErr) => {
                if (accountErr) {
                  return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to provision the purchased account.' }));
                }
                db.run('COMMIT', (commitErr) => {
                  if (commitErr) return res.status(500).json({ error: 'Unable to commit account provisioning.' });
                  if (referrerWallet && referrerWallet.toLowerCase() !== wallet_address.toLowerCase()) {
                    const commissionEarned = finalPrice * 0.02;
                    db.run(
                      `INSERT INTO referrals (referrer_wallet, referee_wallet, plan_id, paid_amount, commission_earned)
                       VALUES (?, ?, ?, ?, ?)`,
                      [referrerWallet, wallet_address, Number(plan_id), finalPrice, commissionEarned]
                    );
                  }
                  res.json({ success: true, account_id: accountId, message: "Account provisioned successfully." });
                });
              }
            );
          }
        );
      });
    });
  });
});

// --- SECURE WITHDRAWAL REQUEST ENDPOINT ---
app.post('/api/withdrawals/request', sensitiveLimiter, requireTradeSignature, (req, res) => {
    const { account_id, wallet_address, amount } = req.body;
    const amountValue = Number(amount);
    const userIp = req.ip;

    if (!account_id || !Number.isFinite(amountValue) || amountValue <= 0) {
        return res.status(400).json({ success: false, error: "Invalid request parameters." });
    }

    const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return res.status(500).json({ success: false, error: 'Unable to start withdrawal request.' });
        db.get(`
            SELECT a.*, p.name as plan_name, p.profit_target, p.simulated_capital
            FROM accounts a 
            JOIN plans p ON a.plan_id = p.id 
            WHERE a.id = ? AND LOWER(a.wallet_address) = LOWER(?)
        `, [account_id, wallet_address], (accountErr, account) => {
          if (accountErr) return rollback(500, 'Unable to load account.');
          if (!account) return rollback(404, 'Account not found or wallet mismatch.');
          if (account.status !== 'ACTIVE') return rollback(400, 'Account is not active.');

          const targetThreshold = account.initial_balance + account.profit_target;
          if (account.current_balance < targetThreshold) {
            const shortFall = targetThreshold - account.current_balance;
            return rollback(400, `Account is not ready for withdrawal. You need $${shortFall.toLocaleString()} more to reach the $${targetThreshold.toLocaleString()} target.`);
          }

          db.get(
            `SELECT COALESCE(SUM(amount), 0) AS reserved FROM withdrawals
             WHERE account_id = ? AND status IN ('PENDING', 'PAID')`,
            [account_id],
            (sumErr, row) => {
              if (sumErr) return rollback(500, 'Unable to verify prior payouts.');
              const reserved = Number(row.reserved) || 0;
              const totalProfit = account.current_balance - account.initial_balance + reserved;
              const maxAllowableWithdrawal = Math.max(0, totalProfit * 0.5 - reserved);
              if (amountValue > maxAllowableWithdrawal) {
                return rollback(400, `Withdrawal exceeds the remaining 50% profit split limit of $${maxAllowableWithdrawal.toLocaleString()} USDT.`);
              }

              db.run(
                `UPDATE accounts SET current_balance = current_balance - ?
                 WHERE id = ? AND current_balance >= ? AND status = 'ACTIVE'`,
                [amountValue, account_id, amountValue],
                function(balanceErr) {
                  if (balanceErr) return rollback(500, 'Unable to reserve withdrawal funds.');
                  if (this.changes !== 1) return rollback(409, 'Account balance changed; refresh and retry.');
                  const withdrawalId = `WDR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
                  db.run(
                    `INSERT INTO withdrawals (id, account_id, wallet_address, type, plan_name, amount, user_ip, status, created_at)
                     VALUES (?, ?, ?, 'PROFIT_SPLIT', ?, ?, ?, 'PENDING', datetime('now'))`,
                    [withdrawalId, account_id, wallet_address, account.plan_name, amountValue, userIp],
                    (insertErr) => {
                      if (insertErr) return rollback(500, 'Unable to record withdrawal request.');
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) return rollback(500, 'Unable to complete withdrawal request.');
                        res.json({ success: true, message: 'Withdrawal request submitted successfully to the admin queue!' });
                      });
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
});

app.post('/api/admin/withdrawals', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
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

app.post('/api/admin/withdrawals/action', sensitiveLimiter, requireTradeSignature, requireAdminWallet, (req, res) => {
  const { withdrawal_id, action, type } = req.body;
  if (!withdrawal_id || !['REJECT', 'PAID'].includes(action) || !['ACCOUNT', 'COMMISSION'].includes(type)) {
    return res.status(400).json({ error: "A valid withdrawal ID and action are required." });
  }

  const isCommission = type === 'COMMISSION';
  const tableName = isCommission ? 'referral_withdrawals' : 'withdrawals';
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return res.status(500).json({ error: 'Unable to start withdrawal update.' });
      db.get(`SELECT * FROM ${tableName} WHERE id = ?`, [withdrawal_id], (err, wdr) => {
        const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ error }));
        if (err) return rollback(500, 'Unable to load withdrawal request.');
        if (!wdr) return rollback(404, 'Withdrawal request not found.');
        if (wdr.status !== 'PENDING') return rollback(409, 'Request already processed.');

        const updateStatus = () => db.run(
          `UPDATE ${tableName} SET status = ? WHERE id = ? AND status = 'PENDING'`,
          [action === 'REJECT' ? 'REJECTED' : 'PAID', withdrawal_id],
          function(updateErr) {
            if (updateErr) return rollback(500, 'Unable to update withdrawal status.');
            if (this.changes !== 1) return rollback(409, 'Request already processed.');
            db.run('COMMIT', (commitErr) => {
              if (commitErr) return rollback(500, 'Unable to commit withdrawal update.');
              res.json({ success: true, message: `Withdrawal marked as ${action}.` });
            });
          }
        );

        if (action !== 'REJECT' || isCommission || !wdr.account_id) return updateStatus();
        db.run(
          'UPDATE accounts SET current_balance = current_balance + ? WHERE id = ?',
          [wdr.amount, wdr.account_id],
          (refundErr) => {
            if (refundErr) return rollback(500, 'Unable to return reserved withdrawal funds.');
            updateStatus();
          }
        );
      });
    });
  });
});

app.post('/api/trades/execute', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { account_id, symbol, side, price, size_usd, margin_used, leverage, sl, tp, wallet_address } = req.body;
  const market = markets.find(item => item.symbol === symbol);
  const numericFields = [price, size_usd, margin_used, leverage];
  if (!account_id || !market || market.enabled === false || !['BUY', 'SELL'].includes(side) ||
      numericFields.some(value => !Number.isFinite(Number(value)) || Number(value) <= 0) ||
      !Number.isInteger(Number(leverage)) || Number(leverage) > 50 ||
      Math.abs(Number(size_usd) - Number(margin_used) * Number(leverage)) > 0.01 ||
      (sl != null && (!Number.isFinite(Number(sl)) || Number(sl) <= 0)) ||
      (tp != null && (!Number.isFinite(Number(tp)) || Number(tp) <= 0))) {
    return res.status(400).json({ error: 'Invalid trade parameters.' });
  }

  db.get(
    `SELECT a.*, p.max_drawdown_pct, p.daily_loss_pct
     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
    [account_id],
    (err, account) => {
      if (err) return res.status(500).json({ error: 'Unable to load account.' });
      if (!account) return res.status(404).json({ error: 'Account not found.' });
      if (account.wallet_address.toLowerCase() !== wallet_address.toLowerCase()) {
        return res.status(403).json({ error: 'Wallet does not own this account.' });
      }

      unlockExpiredAccount(account, (unlockErr, activeLock) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        if (activeLock) {
          const message = activeLock.permanent
            ? 'Account permanently locked after exceeding the maximum loss limit (MLL).'
            : `Account locked for DLL breach until ${activeLock.lockedUntil}.`;
          return res.status(403).json({ error: message, lock: activeLock });
        }

        if (account.status !== 'ACTIVE') {
          return res.status(403).json({ error: `Account is not active (${account.status}).` });
        }

        const existingBreach = getRiskBreach(account, account);
        if (existingBreach) {
          return lockAccount(account_id, existingBreach, (lockErr) => {
            if (lockErr) return res.status(500).json({ error: 'Unable to apply account risk lock.' });
            res.status(403).json({
              error: existingBreach.permanent
                ? 'Account permanently locked after exceeding the maximum loss limit (MLL).'
                : `Account locked for DLL breach until ${existingBreach.lockedUntil}.`,
              lock: existingBreach
            });
          });
        }

        const margin = Number(margin_used);
        if (margin > account.current_balance) {
          return res.status(400).json({ error: `Insufficient available balance ($${account.current_balance.toFixed(2)} available).` });
        }

        getAuthoritativePrice(market).then((marketPrice) => {
          const executionPrice = marketPrice + (side === 'BUY' ? 5 : -5);
          if (executionPrice <= 0 ||
              (side === 'BUY' && ((sl && Number(sl) >= executionPrice) || (tp && Number(tp) <= executionPrice))) ||
              (side === 'SELL' && ((sl && Number(sl) <= executionPrice) || (tp && Number(tp) >= executionPrice)))) {
            return res.status(400).json({ error: 'Stop loss, take profit, or execution price is invalid for this side.' });
          }

          const units = Number(size_usd) / executionPrice;
          const tradeId = `trd_${crypto.randomBytes(8).toString('hex')}`;
          db.serialize(() => {
            db.run('BEGIN IMMEDIATE');
            db.run(
              `UPDATE accounts SET current_balance = current_balance - ?
               WHERE id = ? AND current_balance >= ? AND status = 'ACTIVE'`,
              [margin, account_id, margin],
              function(updateErr) {
                if (updateErr || this.changes !== 1) {
                  return db.run('ROLLBACK', () => res.status(409).json({ error: 'Account balance or status changed. Refresh and retry.' }));
                }
                db.run(
                  `INSERT INTO trades (id, account_id, symbol, side, entry_price, size_usd, units, sl, tp, status, leverage)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
                  [tradeId, account_id, symbol, side, executionPrice, margin, units, sl || null, tp || null, leverage],
                  (insertErr) => {
                    if (insertErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to create trade.' }));
                    db.run('COMMIT', (commitErr) => {
                      if (commitErr) return res.status(500).json({ error: 'Unable to commit trade.' });
                      res.json({ success: true, trade_id: tradeId, execution_price: executionPrice });
                    });
                  }
                );
              }
            );
          });
        }).catch((priceError) => {
          console.error('Unable to obtain trade execution price:', priceError.message);
          res.status(503).json({ error: 'Unable to obtain a fresh market price. Please retry.' });
        });
      });
    }
  );
});

app.post('/api/trades/close', sensitiveLimiter, requireTradeSignature, (req, res) => {
  const { trade_id, wallet_address } = req.body;
  if (!trade_id) return res.status(400).json({ error: 'Trade ID is required.' });

  db.get(
    `SELECT t.*, a.wallet_address, a.current_equity, a.daily_starting_balance,
     a.status AS account_status, a.lock_reason, a.locked_until, a.permanent_lock
     FROM trades t JOIN accounts a ON a.id = t.account_id
     WHERE t.id = ? AND t.status = 'OPEN'`,
    [trade_id],
    (err, trade) => {
      if (err) return res.status(500).json({ error: 'Unable to load trade.' });
      if (!trade) return res.status(404).json({ error: 'Open trade not found.' });
      if (trade.wallet_address.toLowerCase() !== wallet_address.toLowerCase()) {
        return res.status(403).json({ error: 'Wallet does not own this trade.' });
      }

      const account = {
        id: trade.account_id,
        current_equity: trade.current_equity,
        daily_starting_balance: trade.daily_starting_balance,
        status: trade.account_status,
        lock_reason: trade.lock_reason,
        locked_until: trade.locked_until,
        permanent_lock: trade.permanent_lock
      };
      unlockExpiredAccount(account, (unlockErr) => {
        if (unlockErr) return res.status(500).json({ error: 'Unable to refresh account lock status.' });
        const market = markets.find(item => item.symbol === trade.symbol);
        if (!market) return res.status(409).json({ error: 'The trade market is no longer configured.' });
        getAuthoritativePrice(market).then((price) => {
        const priceDiff = trade.side === 'BUY' ? price - trade.entry_price : trade.entry_price - price;
        const pnl = priceDiff * trade.units;
        const returnedMargin = Math.max(0, trade.size_usd + pnl);
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE');
          db.run(
            `UPDATE trades SET status = 'CLOSED', pnl = ?, closed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'OPEN'`,
            [pnl, trade_id],
            function(updateErr) {
              if (updateErr || this.changes !== 1) {
                return db.run('ROLLBACK', () => res.status(409).json({ error: 'Trade was already closed.' }));
              }
              db.run(
                `UPDATE accounts SET current_balance = current_balance + ?, current_equity = current_equity + ?
                 WHERE id = ?`,
                [returnedMargin, pnl, trade.account_id],
                (balanceErr) => {
                  if (balanceErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to settle trade.' }));
                  db.get(
                    `SELECT a.*, p.max_drawdown_pct, p.daily_loss_pct
                     FROM accounts a JOIN plans p ON a.plan_id = p.id WHERE a.id = ?`,
                    [trade.account_id],
                    (accountErr, account) => {
                      if (accountErr || !account) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to verify account limits.' }));
                      const breach = getRiskBreach(account, account);
                      const activeLock = breach || getActiveLock(account);
                      const commit = (lock = null) => db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: 'Unable to commit trade settlement.' });
                        res.json({ success: true, pnl, lock });
                      });
                      if (!breach) return commit(activeLock);
                      lockAccount(trade.account_id, breach, (lockErr) => {
                        if (lockErr) return db.run('ROLLBACK', () => res.status(500).json({ error: 'Unable to apply account lock.' }));
                        commit({
                          reason: breach.reason,
                          permanent: breach.permanent,
                          lockedUntil: breach.lockedUntil
                        });
                      });
                    }
                  );
                }
              );
            }
          );
        });
        }).catch((priceError) => {
          console.error('Unable to obtain trade closing price:', priceError.message);
          res.status(503).json({ error: 'Unable to obtain a fresh market price. Please retry.' });
        });
      });
    }
  );
});

app.get('/api/trades/active', requireWalletSession, (req, res) => {
  const accountId = req.query.account_id;
  const wallet = req.query.wallet;
  if (!accountId || typeof wallet !== 'string' || !ethers.isAddress(wallet) || wallet.toLowerCase() !== req.walletAddress) {
    return res.status(403).json({ error: 'Wallet session does not match the requested trades.' });
  }

  db.get("SELECT wallet_address FROM accounts WHERE id = ?", [accountId], (accountErr, account) => {
    if (accountErr) return res.status(500).json({ error: 'Unable to load account.' });
    if (!account || account.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(403).json({ error: 'Wallet does not own this account.' });
    }
    db.all("SELECT * FROM trades WHERE account_id = ? AND status = 'OPEN'", [accountId], (err, trades) => {
      if (err) return res.status(500).json({ error: 'Unable to load open trades.' });
      res.json({ trades: trades || [] });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Blastrr server running on port ${PORT}`);
});
