import chalk from 'chalk';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config.js';
import { getTransactionWithRetry, parseTransactionSwaps } from './parser.js';
import { formatSol, formatDate, formatAddress } from './utils.js';
import { 
  initDb, 
  getWallets,
  getPortfolio, 
  updatePortfolio, 
  getHoldings, 
  saveHolding, 
  deleteHolding, 
  addTrade 
} from '../src/lib/db.js';
import { executeRealCopyTrades } from '../src/lib/execution.js';

/**
 * Updates the live simulated portfolio database with a new trade.
 * @param {Object} swap - The parsed swap object
 * @param {string} walletAddressStr - Target wallet address string
 * @returns {Promise<Object|null>} Details of simulated trade execution or null if skipped
 */
async function simulateLiveTrade(swap, walletAddressStr) {
  const { type, tokenMint, solAmount, tokenAmount, walletSolBalanceBefore } = swap;
  const txFeeSol = config.txFeeSol;

  // Retrieve target wallet's isolated portfolio state from database
  const portfolio = await getPortfolio(walletAddressStr);
  if (!portfolio) {
    return { status: 'failed', reason: 'Portfolio record not initialized in database' };
  }

  if (type === 'buy') {
    if (solAmount < config.minTargetEntrySize) return null; // Skip under threshold

    // Risk scaled calculation
    const targetRiskRatio = solAmount / (walletSolBalanceBefore || 1.0);
    const rawSize = targetRiskRatio * config.startCapital;
    const copySize = Math.max(config.minCopySize, Math.min(config.maxCopySize, rawSize));

    if (portfolio.capital < copySize + txFeeSol) {
      return { status: 'failed', reason: 'Insufficient simulated capital' };
    }

    const entryPrice = solAmount / tokenAmount;
    const tokensBought = copySize / entryPrice;

    // Deduct capital
    const newCapital = portfolio.capital - (copySize + txFeeSol);
    const newFees = portfolio.totalFees + txFeeSol;
    await updatePortfolio(walletAddressStr, newCapital, newFees);

    // Update holdings
    const holdings = await getHoldings(walletAddressStr);
    let holding = holdings.find(h => h.mint === tokenMint);

    const now = Date.now();
    if (!holding) {
      holding = {
        mint: tokenMint,
        amount: 0,
        solSpent: 0,
        entryPrice: entryPrice,
        entryTime: now
      };
    }

    holding.amount += tokensBought;
    holding.solSpent += copySize;
    holding.entryPrice = holding.solSpent / holding.amount;

    await saveHolding(walletAddressStr, holding.mint, holding.amount, holding.solSpent, holding.entryPrice, holding.entryTime);

    return {
      status: 'success',
      copySize,
      tokensBought,
      entryPrice,
      newCapital
    };
  } 
  
  else if (type === 'sell') {
    const holdings = await getHoldings(walletAddressStr);
    const holding = holdings.find(h => h.mint === tokenMint);
    if (!holding || holding.amount <= 0) return null;

    // Rule: Fully exit the trade (sell 100%) when the target sells even a tiny fraction of the memecoin
    const sellFraction = 1.0;
    const tokensToSell = holding.amount;
    if (tokensToSell <= 0) return null;

    const exitPrice = solAmount / tokenAmount;
    const solReceived = tokensToSell * exitPrice;
    const costBasis = holding.solSpent;
    const netPnL = solReceived - costBasis - txFeeSol;
    const pnlPercent = ((solReceived - costBasis) / costBasis) * 100;

    // Update capital and fees
    const newCapital = portfolio.capital + (solReceived - txFeeSol);
    const newFees = portfolio.totalFees + txFeeSol;
    await updatePortfolio(walletAddressStr, newCapital, newFees);

    // Save completed trade to log
    const now = Date.now();
    await addTrade(walletAddressStr, {
      tokenMint,
      buyTime: holding.entryTime,
      sellTime: now,
      solInvested: costBasis,
      solReceived,
      netPnL,
      pnlPercent,
      sellFraction,
      buyHash: 'N/A',
      sellHash: swap.txHash || 'N/A'
    });

    // Delete holding
    await deleteHolding(walletAddressStr, tokenMint);

    return {
      status: 'success',
      sellFraction,
      tokensSold: tokensToSell,
      solReceived,
      netPnL,
      pnlPercent,
      newCapital
    };
  }

  return null;
}

/**
 * Starts real-time monitoring of all tracked wallets in the database.
 */
export async function startMonitor() {
  console.clear();
  console.log(chalk.bold.cyan('====================================================='));
  console.log(chalk.bold.cyan('       SOLANA REAL-TIME COPY TRADING MONITOR         '));
  console.log(chalk.bold.cyan('====================================================='));
  
  await initDb();
  const trackedWallets = await getWallets();

  if (trackedWallets.length === 0) {
    console.log(chalk.yellow('No wallets are currently being tracked.'));
    console.log(chalk.gray('Please add at least one wallet to monitor in the web dashboard.'));
    return;
  }

  console.log(chalk.gray(`Tracking ${trackedWallets.length} wallet(s):`));
  trackedWallets.forEach(w => {
    console.log(`  - "${w.name}" (${w.address})`);
  });
  console.log(`${chalk.gray('RPC Endpoint:')}    ${chalk.yellow(config.rpcUrl)}`);
  console.log(`${chalk.gray('Initial Capital:')} ${chalk.green(formatSol(config.startCapital))}`);
  console.log(`${chalk.gray('Copy Threshold:')} ${chalk.green(`${config.minTargetEntrySize} SOL`)}`);
  console.log(`${chalk.gray('Copy Sizing:')}    ${chalk.green(`${config.minCopySize} - ${config.maxCopySize} SOL (Risk-Scaled)`)}`);
  console.log(chalk.cyan('-----------------------------------------------------'));
  console.log(chalk.yellow('Listening for on-chain events... Press Ctrl+C to exit.\n'));

  // For maximum stability, use the public Solana WebSocket node for subscriptions,
  // and use your fast Helius RPC HTTP endpoint to fetch the actual transaction details.
  const connection = new Connection(config.rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: 'wss://api.mainnet-beta.solana.com'
  });
  const subscriptionIds = [];

  for (const wallet of trackedWallets) {
    let pubkey;
    try {
      pubkey = new PublicKey(wallet.address);
    } catch (err) {
      console.warn(chalk.red(`[WARN] Skipping invalid wallet address: "${wallet.address}"`));
      continue;
    }

    const subId = connection.onLogs(
      pubkey,
      async (logs, context) => {
        const signature = logs.signature;
        if (logs.err) return; // Skip failed transactions

        console.log(chalk.gray(`[LOGS] [${wallet.name}] Detected activity on signature: ${signature.slice(0, 10)}...`));

        try {
          const tx = await getTransactionWithRetry(connection, signature);
          if (!tx) return;

          const swaps = parseTransactionSwaps(tx, wallet.address);
          if (!swaps) return;

          for (const swap of swaps) {
            const timeStr = formatDate(swap.blockTime);
            const formattedMint = formatAddress(swap.tokenMint);
            
            if (swap.type === 'buy') {
              if (swap.solAmount >= config.minTargetEntrySize) {
                console.log(chalk.bold.green(`\n🟢 [BUY DETECTED] [${wallet.name}] bought token [${formattedMint}]`));
                console.log(chalk.gray(`  Tx Hash:   ${signature}`));
                console.log(chalk.gray(`  Time:      ${timeStr}`));
                console.log(chalk.gray(`  SOL Spent: ${formatSol(swap.solAmount)}`));
                console.log(chalk.gray(`  Target Balance: ${swap.walletSolBalanceBefore ? swap.walletSolBalanceBefore.toFixed(2) : 'N/A'} SOL`));

                const simulation = await simulateLiveTrade(swap, wallet.address);

                if (simulation && simulation.status === 'success') {
                  console.log(chalk.bold.bgGreen.black(' ACTION COMPLETED (SIMULATION) '));
                  console.log(`  👉 ${chalk.bold('COPIED BUY:')} Bought ${chalk.yellow(simulation.tokensBought.toLocaleString())} tokens for ${chalk.green(formatSol(simulation.copySize))}`);
                  console.log(`  💰 ${chalk.bold('New Capital:')} ${chalk.green(formatSol(simulation.newCapital))}`);
                } else if (simulation && simulation.status === 'failed') {
                  console.log(chalk.bold.red(`  ❌ COPY FAILED: ${simulation.reason}`));
                }
              } else {
                console.log(chalk.bold.gray(`\n⚪ [BUY SKIPPED] [${wallet.name}] bought [${formattedMint}] for ${formatSol(swap.solAmount)} (Under ${config.minTargetEntrySize} SOL threshold)`));
              }
            } 
            
            else if (swap.type === 'sell') {
              console.log(chalk.bold.red(`\n🔴 [SELL DETECTED] [${wallet.name}] sold token [${formattedMint}]`));
              console.log(chalk.gray(`  Tx Hash:      ${signature}`));
              console.log(chalk.gray(`  Time:         ${timeStr}`));
              console.log(chalk.gray(`  SOL Received: ${formatSol(swap.solAmount)}`));

              const simulation = await simulateLiveTrade(swap, wallet.address);

              if (simulation && simulation.status === 'success') {
                const pnlColor = simulation.netPnL >= 0 ? chalk.green : chalk.red;
                const sign = simulation.netPnL >= 0 ? '+' : '';
                console.log(chalk.bold.bgRed.black(' ACTION COMPLETED (SIMULATION) '));
                console.log(`  👉 ${chalk.bold('COPIED SELL:')} Sold 100% of holdings (${simulation.tokensSold.toLocaleString()} tokens)`);
                console.log(`  💰 ${chalk.bold('SOL Received:')} ${chalk.green(formatSol(simulation.solReceived))}`);
                console.log(`  📈 ${chalk.bold('Trade PnL:')}    ${pnlColor(`${sign}${formatSol(simulation.netPnL)} (${simulation.pnlPercent.toFixed(2)}%)`)}`);
                console.log(`  💰 ${chalk.bold('New Capital:')}   ${chalk.green(formatSol(simulation.newCapital))}`);
              } else {
                console.log(chalk.bold.gray(`  ⚪ NO ACTION: We are not holding token [${formattedMint}]`));
              }
            }

            // Trigger real on-chain copy trading
            await executeRealCopyTrades(swap, wallet.address);
          }
        } catch (err) {
          console.error(chalk.red(`[ERROR] Failed to process transaction ${signature}: ${err.message}`));
        }
      },
      'confirmed'
    );
    subscriptionIds.push({ subId, pubkey });
  }

  // Keep program running until terminated
  process.on('SIGINT', () => {
    console.log(chalk.cyan('\nUnsubscribing and shutting down...'));
    subscriptionIds.forEach(({ subId }) => {
      connection.removeOnLogsListener(subId);
    });
    console.log(chalk.green('Done. Goodbye!'));
    process.exit(0);
  });
}
