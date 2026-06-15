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
        CREATE TABLE IF NOT EXISTS execution_wallets (
          address VARCHAR(50) PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS copy_settings (
          id SERIAL PRIMARY KEY,
          target_wallet VARCHAR(50) REFERENCES wallets(address) ON DELETE CASCADE,
          execution_wallet VARCHAR(50) REFERENCES execution_wallets(address) ON DELETE CASCADE,
          copy_size DOUBLE PRECISION NOT NULL,
          slippage_bps INTEGER DEFAULT 1000,
          is_active BOOLEAN DEFAULT TRUE,
          UNIQUE(target_wallet, execution_wallet)
        );
        CREATE TABLE IF NOT EXISTS real_holdings (
          execution_wallet VARCHAR(50) REFERENCES execution_wallets(address) ON DELETE CASCADE,
          mint VARCHAR(50) NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          sol_spent DOUBLE PRECISION NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          entry_time TIMESTAMP NOT NULL,
          PRIMARY KEY (execution_wallet, mint)
        );
        CREATE TABLE IF NOT EXISTS real_trades (
          id SERIAL PRIMARY KEY,
          target_wallet VARCHAR(50),
          execution_wallet VARCHAR(50) REFERENCES execution_wallets(address) ON DELETE CASCADE,
          token_mint VARCHAR(50) NOT NULL,
          buy_time TIMESTAMP NOT NULL,
          sell_time TIMESTAMP,
          sol_invested DOUBLE PRECISION,
          sol_received DOUBLE PRECISION,
          net_pnl DOUBLE PRECISION,
          pnl_percent DOUBLE PRECISION,
          buy_tx VARCHAR(100),
          sell_tx VARCHAR(100),
          status VARCHAR(20) DEFAULT 'OPEN'
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
    fs.writeFileSync(dbPath, JSON.stringify({ 
      wallets: [], 
      portfolios: {}, 
      holdings: {}, 
      trades: {},
      executionWallets: [],
      copySettings: [],
      realHoldings: {},
      realTrades: {}
    }), 'utf8');
  }
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  if (!data.executionWallets) data.executionWallets = [];
  if (!data.copySettings) data.copySettings = [];
  if (!data.realHoldings) data.realHoldings = {};
  if (!data.realTrades) data.realTrades = {};
  return data;
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

/**
 * Retrieves all imported execution wallets.
 */
export async function getExecutionWallets() {
  if (pool) {
    const res = await pool.query('SELECT address, name, encrypted_private_key AS "encryptedPrivateKey" FROM execution_wallets ORDER BY created_at ASC');
    return res.rows;
  } else {
    const data = readLocalDb();
    return data.executionWallets;
  }
}

/**
 * Saves/updates an execution wallet.
 */
export async function addExecutionWallet(address, name, encryptedPrivateKey) {
  if (pool) {
    await pool.query(`
      INSERT INTO execution_wallets (address, name, encrypted_private_key) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (address) 
      DO UPDATE SET name = $2, encrypted_private_key = $3
    `, [address, name, encryptedPrivateKey]);
  } else {
    const data = readLocalDb();
    const existingIdx = data.executionWallets.findIndex(w => w.address === address);
    if (existingIdx > -1) {
      data.executionWallets[existingIdx] = { address, name, encryptedPrivateKey };
    } else {
      data.executionWallets.push({ address, name, encryptedPrivateKey });
    }
    writeLocalDb(data);
  }
}

/**
 * Deletes an execution wallet.
 */
export async function deleteExecutionWallet(address) {
  if (pool) {
    await pool.query('DELETE FROM execution_wallets WHERE address = $1', [address]);
  } else {
    const data = readLocalDb();
    data.executionWallets = data.executionWallets.filter(w => w.address !== address);
    data.copySettings = data.copySettings.filter(s => s.executionWallet !== address);
    delete data.realHoldings[address];
    delete data.realTrades[address];
    writeLocalDb(data);
  }
}

/**
 * Retrieves all copy settings mappings.
 */
export async function getCopySettings() {
  if (pool) {
    const res = await pool.query(`
      SELECT id, target_wallet AS "targetWallet", execution_wallet AS "executionWallet", 
             copy_size AS "copySize", slippage_bps AS "slippageBps", is_active AS "isActive" 
      FROM copy_settings
    `);
    return res.rows;
  } else {
    const data = readLocalDb();
    return data.copySettings;
  }
}

/**
 * Saves/updates a copy setting.
 */
export async function saveCopySetting(targetWallet, executionWallet, copySize, slippageBps, isActive) {
  if (pool) {
    await pool.query(`
      INSERT INTO copy_settings (target_wallet, execution_wallet, copy_size, slippage_bps, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (target_wallet, execution_wallet)
      DO UPDATE SET copy_size = $3, slippage_bps = $4, is_active = $5
    `, [targetWallet, executionWallet, copySize, slippageBps, isActive]);
  } else {
    const data = readLocalDb();
    const existingIdx = data.copySettings.findIndex(
      s => s.targetWallet === targetWallet && s.executionWallet === executionWallet
    );
    const item = { targetWallet, executionWallet, copySize: parseFloat(copySize), slippageBps: parseInt(slippageBps, 10), isActive };
    if (existingIdx > -1) {
      data.copySettings[existingIdx] = item;
    } else {
      data.copySettings.push(item);
    }
    writeLocalDb(data);
  }
}

/**
 * Deletes a copy setting mapping.
 */
export async function deleteCopySetting(targetWallet, executionWallet) {
  if (pool) {
    await pool.query('DELETE FROM copy_settings WHERE target_wallet = $1 AND execution_wallet = $2', [targetWallet, executionWallet]);
  } else {
    const data = readLocalDb();
    data.copySettings = data.copySettings.filter(
      s => !(s.targetWallet === targetWallet && s.executionWallet === executionWallet)
    );
    writeLocalDb(data);
  }
}

/**
 * Retrieves completed real trades for an execution wallet.
 */
export async function getRealTrades(executionWallet) {
  if (pool) {
    const res = await pool.query(`
      SELECT id, target_wallet AS "targetWallet", execution_wallet AS "executionWallet", 
             token_mint AS "tokenMint", buy_time AS "buyTime", sell_time AS "sellTime", 
             sol_invested AS "solInvested", sol_received AS "solReceived", 
             net_pnl AS "netPnL", pnl_percent AS "pnlPercent", 
             buy_tx AS "buyHash", sell_tx AS "sellHash", status
      FROM real_trades
      WHERE execution_wallet = $1
      ORDER BY buy_time DESC
    `, [executionWallet]);
    return res.rows;
  } else {
    const data = readLocalDb();
    return data.realTrades[executionWallet] || [];
  }
}

/**
 * Adds an initial real trade log (Buy entry). Returns the auto-increment ID.
 */
export async function addRealTrade(trade) {
  if (pool) {
    const res = await pool.query(`
      INSERT INTO real_trades (target_wallet, execution_wallet, token_mint, buy_time, sol_invested, buy_tx, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
      RETURNING id
    `, [
      trade.targetWallet,
      trade.executionWallet,
      trade.tokenMint,
      new Date(trade.buyTime),
      trade.solInvested,
      trade.buyHash
    ]);
    return res.rows[0].id;
  } else {
    const data = readLocalDb();
    if (!data.realTrades[trade.executionWallet]) {
      data.realTrades[trade.executionWallet] = [];
    }
    const newId = data.realTrades[trade.executionWallet].length + 1;
    data.realTrades[trade.executionWallet].unshift({
      id: newId,
      targetWallet: trade.targetWallet,
      executionWallet: trade.executionWallet,
      tokenMint: trade.tokenMint,
      buyTime: new Date(trade.buyTime).toISOString(),
      sellTime: null,
      solInvested: trade.solInvested,
      solReceived: null,
      netPnL: null,
      pnlPercent: null,
      buyHash: trade.buyHash,
      sellHash: null,
      status: 'OPEN'
    });
    writeLocalDb(data);
    return newId;
  }
}

/**
 * Updates a real trade log with exit details (Sell execute).
 */
export async function updateRealTrade(id, updateFields) {
  if (pool) {
    await pool.query(`
      UPDATE real_trades
      SET sell_time = $1, sol_received = $2, net_pnl = $3, pnl_percent = $4, sell_tx = $5, status = $6
      WHERE id = $7
    `, [
      new Date(updateFields.sellTime),
      updateFields.solReceived,
      updateFields.netPnL,
      updateFields.pnlPercent,
      updateFields.sellHash,
      updateFields.status,
      id
    ]);
  } else {
    const data = readLocalDb();
    // Search in all execution wallets' trades for simplicity
    for (const key in data.realTrades) {
      const idx = data.realTrades[key].findIndex(t => t.id === id);
      if (idx > -1) {
        data.realTrades[key][idx] = {
          ...data.realTrades[key][idx],
          sellTime: new Date(updateFields.sellTime).toISOString(),
          solReceived: updateFields.solReceived,
          netPnL: updateFields.netPnL,
          pnlPercent: updateFields.pnlPercent,
          sellHash: updateFields.sellHash,
          status: updateFields.status
        };
        break;
      }
    }
    writeLocalDb(data);
  }
}

/**
 * Gets active real holdings for an execution wallet.
 */
export async function getRealHoldings(executionWallet) {
  if (pool) {
    const res = await pool.query(`
      SELECT mint, amount, sol_spent AS "solSpent", entry_price AS "entryPrice", entry_time AS "entryTime" 
      FROM real_holdings 
      WHERE execution_wallet = $1
    `, [executionWallet]);
    return res.rows;
  } else {
    const data = readLocalDb();
    const holdings = data.realHoldings[executionWallet] || {};
    return Object.values(holdings);
  }
}

/**
 * Saves or updates a real token holding.
 */
export async function saveRealHolding(executionWallet, mint, amount, solSpent, entryPrice, entryTime) {
  if (pool) {
    await pool.query(`
      INSERT INTO real_holdings (execution_wallet, mint, amount, sol_spent, entry_price, entry_time)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (execution_wallet, mint)
      DO UPDATE SET amount = $3, sol_spent = $4, entry_price = $5, entry_time = $6
    `, [executionWallet, mint, amount, solSpent, entryPrice, new Date(entryTime)]);
  } else {
    const data = readLocalDb();
    if (!data.realHoldings[executionWallet]) {
      data.realHoldings[executionWallet] = {};
    }
    data.realHoldings[executionWallet][mint] = {
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
 * Deletes a real token holding.
 */
export async function deleteRealHolding(executionWallet, mint) {
  if (pool) {
    await pool.query('DELETE FROM real_holdings WHERE execution_wallet = $1 AND mint = $2', [executionWallet, mint]);
  } else {
    const data = readLocalDb();
    if (data.realHoldings[executionWallet]) {
      delete data.realHoldings[executionWallet][mint];
      writeLocalDb(data);
    }
  }
}
