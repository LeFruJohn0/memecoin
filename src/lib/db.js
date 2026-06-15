import pg from 'pg';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'db.json');
let pool = null;

// Initialize Postgres connection pool if DATABASE_URL is present
if (process.env.DATABASE_URL) {
  const { Pool } = pg;
  let connectionString = process.env.DATABASE_URL;
  try {
    const parsedUrl = new URL(connectionString);
    parsedUrl.searchParams.delete('sslmode');
    connectionString = parsedUrl.toString();
  } catch (err) {
    // fallback if not a valid URL format
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

/**
 * Initializes the database tables (Postgres) or database file (local JSON).
 * Also seeds a default wallet if none exist.
 */
export async function initDb() {
  if (pool) {
    try {
      // 1. Create tables in PostgreSQL
      await pool.query(`
        CREATE TABLE IF NOT EXISTS wallets (
          address VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS portfolio (
          target_wallet VARCHAR(50) PRIMARY KEY REFERENCES wallets(address) ON DELETE CASCADE,
          capital DOUBLE PRECISION NOT NULL,
          total_fees DOUBLE PRECISION NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS holdings (
          target_wallet VARCHAR(50) REFERENCES wallets(address) ON DELETE CASCADE,
          mint VARCHAR(50) NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          sol_spent DOUBLE PRECISION NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          entry_time TIMESTAMP NOT NULL,
          PRIMARY KEY (target_wallet, mint)
        );
        CREATE TABLE IF NOT EXISTS trades (
          id SERIAL PRIMARY KEY,
          target_wallet VARCHAR(50) REFERENCES wallets(address) ON DELETE CASCADE,
          token_mint VARCHAR(50) NOT NULL,
          buy_time TIMESTAMP NOT NULL,
          sell_time TIMESTAMP NOT NULL,
          sol_invested DOUBLE PRECISION NOT NULL,
          sol_received DOUBLE PRECISION NOT NULL,
          net_pnl DOUBLE PRECISION NOT NULL,
          pnl_percent DOUBLE PRECISION NOT NULL,
          buy_tx VARCHAR(100) NOT NULL,
          sell_tx VARCHAR(100) NOT NULL
        );
      `);

      // Seed a default wallet if tables are empty
      const walletCount = await pool.query('SELECT count(*) FROM wallets');
      if (parseInt(walletCount.rows[0].count, 10) === 0) {
        const defaultWallet = 'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC';
        await pool.query('INSERT INTO wallets (address, name) VALUES ($1, $2)', [defaultWallet, 'Trader Alpha']);
        await pool.query('INSERT INTO portfolio (target_wallet, capital, total_fees) VALUES ($1, 1.0, 0.0)', [defaultWallet]);
      }
    } catch (err) {
      console.error('[DATABASE ERROR] Failed to initialize PostgreSQL:', err.message);
      throw err;
    }
  } else {
    // 2. Initialize local JSON file
    if (!fs.existsSync(dbPath)) {
      const defaultWallet = 'B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC';
      const initialData = {
        wallets: [
          { address: defaultWallet, name: 'Trader Alpha' }
        ],
        portfolios: {
          [defaultWallet]: { capital: 1.0, total_fees: 0.0, updated_at: new Date().toISOString() }
        },
        holdings: {
          [defaultWallet]: {}
        },
        trades: {
          [defaultWallet]: []
        }
      };
      fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2), 'utf8');
    }
  }
}

// Helper to read local JSON database
function readLocalDb() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ wallets: [], portfolios: {}, holdings: {}, trades: {} }), 'utf8');
  }
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

// Helper to write local JSON database
function writeLocalDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Returns all tracked wallets.
 */
export async function getWallets() {
  if (pool) {
    const res = await pool.query('SELECT address, name FROM wallets ORDER BY created_at ASC');
    return res.rows;
  } else {
    const data = readLocalDb();
    return data.wallets || [];
  }
}

/**
 * Adds a new wallet to track and initializes its simulated portfolio.
 */
export async function addWallet(address, name) {
  if (pool) {
    // Insert wallet, ignore if already exists
    await pool.query('INSERT INTO wallets (address, name) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET name = $2', [address, name]);
    // Initialize portfolio if not already present
    await pool.query('INSERT INTO portfolio (target_wallet, capital, total_fees) VALUES ($1, 1.0, 0.0) ON CONFLICT DO NOTHING', [address]);
  } else {
    const data = readLocalDb();
    if (!data.wallets.some(w => w.address === address)) {
      data.wallets.push({ address, name });
    } else {
      // Update nickname if wallet exists
      const w = data.wallets.find(w => w.address === address);
      w.name = name;
    }
    
    if (!data.portfolios[address]) {
      data.portfolios[address] = { capital: 1.0, total_fees: 0.0, updated_at: new Date().toISOString() };
    }
    if (!data.holdings[address]) {
      data.holdings[address] = {};
    }
    if (!data.trades[address]) {
      data.trades[address] = [];
    }
    writeLocalDb(data);
  }
}

/**
 * Removes a wallet and wipes its portfolio, holdings, and trades.
 */
export async function deleteWallet(address) {
  if (pool) {
    await pool.query('DELETE FROM wallets WHERE address = $1', [address]);
  } else {
    const data = readLocalDb();
    data.wallets = data.wallets.filter(w => w.address !== address);
    delete data.portfolios[address];
    delete data.holdings[address];
    delete data.trades[address];
    writeLocalDb(data);
  }
}

/**
 * Retrieves portfolio stats for a wallet.
 */
export async function getPortfolio(walletAddress) {
  if (pool) {
    const res = await pool.query('SELECT capital, total_fees FROM portfolio WHERE target_wallet = $1', [walletAddress]);
    if (res.rows.length === 0) return null;
    return {
      capital: res.rows[0].capital,
      totalFees: res.rows[0].total_fees
    };
  } else {
    const data = readLocalDb();
    const port = data.portfolios[walletAddress];
    if (!port) return null;
    return {
      capital: port.capital,
      totalFees: port.total_fees
    };
  }
}

/**
 * Updates portfolio stats for a wallet.
 */
export async function updatePortfolio(walletAddress, capital, totalFees) {
  if (pool) {
    await pool.query(
      'UPDATE portfolio SET capital = $1, total_fees = $2, updated_at = CURRENT_TIMESTAMP WHERE target_wallet = $3',
      [capital, totalFees, walletAddress]
    );
  } else {
    const data = readLocalDb();
    if (data.portfolios[walletAddress]) {
      data.portfolios[walletAddress].capital = capital;
      data.portfolios[walletAddress].total_fees = totalFees;
      data.portfolios[walletAddress].updated_at = new Date().toISOString();
      writeLocalDb(data);
    }
  }
}

/**
 * Gets active holdings for a wallet.
 */
export async function getHoldings(walletAddress) {
  if (pool) {
    const res = await pool.query('SELECT mint, amount, sol_spent AS "solSpent", entry_price AS "entryPrice", entry_time AS "entryTime" FROM holdings WHERE target_wallet = $1', [walletAddress]);
    return res.rows;
  } else {
    const data = readLocalDb();
    const walletHoldings = data.holdings[walletAddress] || {};
    return Object.values(walletHoldings);
  }
}

/**
 * Saves or updates a token holding for a wallet.
 */
export async function saveHolding(walletAddress, mint, amount, solSpent, entryPrice, entryTime) {
  if (pool) {
    await pool.query(`
      INSERT INTO holdings (target_wallet, mint, amount, sol_spent, entry_price, entry_time)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (target_wallet, mint)
      DO UPDATE SET amount = $3, sol_spent = $4, entry_price = $5, entry_time = $6
    `, [walletAddress, mint, amount, solSpent, entryPrice, new Date(entryTime)]);
  } else {
    const data = readLocalDb();
    if (!data.holdings[walletAddress]) {
      data.holdings[walletAddress] = {};
    }
    data.holdings[walletAddress][mint] = {
      mint,
      amount,
      solSpent,
      entryPrice,
      entryTime: new Date(entryTime).toISOString()
    };
    writeLocalDb(data);
  }
}

/**
 * Deletes a token holding for a wallet.
 */
export async function deleteHolding(walletAddress, mint) {
  if (pool) {
    await pool.query('DELETE FROM holdings WHERE target_wallet = $1 AND mint = $2', [walletAddress, mint]);
  } else {
    const data = readLocalDb();
    if (data.holdings[walletAddress]) {
      delete data.holdings[walletAddress][mint];
      writeLocalDb(data);
    }
  }
}

/**
 * Retrieves completed trades for a wallet.
 */
export async function getTrades(walletAddress) {
  if (pool) {
    const res = await pool.query(`
      SELECT token_mint AS "tokenMint", buy_time AS "buyTime", sell_time AS "sellTime", 
             sol_invested AS "solInvested", sol_received AS "solReceived", 
             net_pnl AS "netPnL", pnl_percent AS "pnlPercent", buy_tx AS "buyHash", sell_tx AS "sellHash"
      FROM trades 
      WHERE target_wallet = $1 
      ORDER BY sell_time DESC
    `, [walletAddress]);
    return res.rows;
  } else {
    const data = readLocalDb();
    return data.trades[walletAddress] || [];
  }
}

/**
 * Adds a completed trade record for a wallet.
 */
export async function addTrade(walletAddress, trade) {
  if (pool) {
    await pool.query(`
      INSERT INTO trades (target_wallet, token_mint, buy_time, sell_time, sol_invested, sol_received, net_pnl, pnl_percent, buy_tx, sell_tx)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      walletAddress,
      trade.tokenMint,
      new Date(trade.buyTime),
      new Date(trade.sellTime),
      trade.solInvested,
      trade.solReceived,
      trade.netPnL,
      trade.pnlPercent,
      trade.buyHash,
      trade.sellHash
    ]);
  } else {
    const data = readLocalDb();
    if (!data.trades[walletAddress]) {
      data.trades[walletAddress] = [];
    }
    data.trades[walletAddress].unshift({
      tokenMint: trade.tokenMint,
      buyTime: new Date(trade.buyTime).toISOString(),
      sellTime: new Date(trade.sellTime).toISOString(),
      solInvested: trade.solInvested,
      solReceived: trade.solReceived,
      netPnL: trade.netPnL,
      pnlPercent: trade.pnlPercent,
      buyHash: trade.buyHash,
      sellHash: trade.sellHash
    });
    writeLocalDb(data);
  }
}
