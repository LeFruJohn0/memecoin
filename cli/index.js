import { Connection } from '@solana/web3.js';
import ora from 'ora';
import chalk from 'chalk';
import Table from 'cli-table3';

import { config } from './config.js';
import { getTransactionWithRetry, parseTransactionSwaps } from './parser.js';
import { runSimulation } from './simulator.js';
import { startMonitor } from './monitor.js';
import { formatSol, formatPercent, formatDate, formatAddress, sleep } from './utils.js';

/**
 * Main application router.
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ? args[0].toLowerCase() : 'help';

  if (command === 'backtest') {
    const limit = args[1] ? parseInt(args[1], 10) : 100;
    if (isNaN(limit) || limit <= 0) {
      console.error(chalk.red('[ERROR] Limit must be a positive number.'));
      process.exit(1);
    }
    await runBacktest(limit);
  } else if (command === 'monitor') {
    await startMonitor();
  } else {
    printHelp();
  }
}

/**
 * Prints CLI usage instructions.
 */
function printHelp() {
  console.log(chalk.bold.cyan('\n====================================================='));
  console.log(chalk.bold.cyan('       SOLANA COPY TRADING SIMULATOR & MONITOR       '));
  console.log(chalk.bold.cyan('====================================================='));
  console.log(chalk.yellow('\nUsage:'));
  console.log(`  node index.js backtest [limit]   - Run a historical backtest of the last N transactions (default: 100)`);
  console.log(`  node index.js monitor            - Start a live monitor subscribing to new trades`);
  
  console.log(chalk.yellow('\nConfiguration (set via .env):'));
  console.log(`  TARGET_WALLET : ${chalk.gray(config.targetWalletStr)}`);
  console.log(`  RPC_URL       : ${chalk.gray(config.rpcUrl)}`);
  console.log(`  START_CAPITAL : ${chalk.gray(config.startCapital + ' SOL')}`);
  console.log(`  MIN_COPY_SIZE : ${chalk.gray(config.minCopySize + ' SOL')}`);
  console.log(`  MAX_COPY_SIZE : ${chalk.gray(config.maxCopySize + ' SOL')}`);
  console.log('');
}

/**
 * Fetches historical transactions and runs copy-trading simulation.
 * @param {number} limit - Number of transaction signatures to fetch
 */
async function runBacktest(limit) {
  console.clear();
  console.log(chalk.bold.cyan('====================================================='));
  console.log(chalk.bold.cyan('          SOLANA COPY TRADING BACKTEST ENGINE        '));
  console.log(chalk.bold.cyan('====================================================='));
  console.log(`${chalk.gray('Target Wallet:')}   ${chalk.yellow(config.targetWalletStr)}`);
  console.log(`${chalk.gray('RPC Endpoint:')}    ${chalk.yellow(config.rpcUrl)}`);
  console.log(`${chalk.gray('Initial Capital:')} ${chalk.green(formatSol(config.startCapital))}`);
  console.log(`${chalk.gray('Copy Sizing:')}     ${chalk.green(`${config.minCopySize} - ${config.maxCopySize} SOL`)}`);
  console.log(chalk.cyan('-----------------------------------------------------'));

  const connection = new Connection(config.rpcUrl, 'confirmed');
  
  // 1. Fetching signatures
  const sigSpinner = ora(`Fetching transaction signatures (limit: ${limit})...`).start();
  let signatures = [];
  let lastSig = null;

  try {
    while (signatures.length < limit) {
      const fetchLimit = Math.min(100, limit - signatures.length);
      const options = { limit: fetchLimit };
      if (lastSig) options.before = lastSig;

      const sigs = await connection.getSignaturesForAddress(config.targetWallet, options);
      if (sigs.length === 0) break;

      signatures.push(...sigs);
      lastSig = sigs[sigs.length - 1].signature;

      if (sigs.length < fetchLimit) break;
    }
    sigSpinner.succeed(`Successfully fetched ${signatures.length} transaction signatures.`);
  } catch (err) {
    sigSpinner.fail(`Failed to fetch signatures: ${err.message}`);
    process.exit(1);
  }

  if (signatures.length === 0) {
    console.log(chalk.yellow('\nNo transactions found for the specified wallet address.'));
    return;
  }

  // 2. Fetching transaction details and parsing swaps
  console.log(chalk.yellow(`\nFetching transaction details & parsing swaps. This may take a moment due to RPC rate limiting...`));
  const txSpinner = ora({ text: 'Processing transactions: 0%', color: 'yellow' }).start();
  
  const swaps = [];
  let processedCount = 0;

  for (let i = 0; i < signatures.length; i++) {
    const sigInfo = signatures[i];
    
    // Skip failed transactions early
    if (sigInfo.err) {
      processedCount++;
      txSpinner.text = `Processing transactions: ${Math.round((processedCount / signatures.length) * 100)}% (${processedCount}/${signatures.length})`;
      continue;
    }

    try {
      const tx = await getTransactionWithRetry(connection, sigInfo.signature);
      processedCount++;
      txSpinner.text = `Processing transactions: ${Math.round((processedCount / signatures.length) * 100)}% (${processedCount}/${signatures.length})`;

      if (tx) {
        const parsedSwaps = parseTransactionSwaps(tx, config.targetWalletStr);
        if (parsedSwaps) {
          swaps.push(...parsedSwaps);
        }
      }
    } catch (err) {
      // Gracefully log error inside spinner and continue
      txSpinner.info(`Skipped signature ${sigInfo.signature.slice(0, 8)} due to fetch error.`);
      processedCount++;
      txSpinner.start();
    }
  }

  txSpinner.succeed(`Processed ${processedCount} transactions. Found ${swaps.length} swap trade events.`);

  if (swaps.length === 0) {
    console.log(chalk.yellow('\nNo eligible swap buy/sell transactions were found for the target wallet.'));
    return;
  }

  // 3. Run simulations side-by-side
  console.log(chalk.yellow('\nRunning strategy simulations...'));
  
  const opt = {
    startCapital: config.startCapital,
    minCopySize: config.minCopySize,
    maxCopySize: config.maxCopySize,
    txFeeSol: config.txFeeSol
  };

  const simFixed05 = runSimulation(swaps, 'fixed_0.05', opt);
  const simFixed10 = runSimulation(swaps, 'fixed_0.10', opt);
  const simRiskScaled = runSimulation(swaps, 'risk_scaled', opt);

  // 4. Render comparative results table
  const table = new Table({
    head: [
      chalk.bold.cyan('Strategy'),
      chalk.bold.cyan('Initial SOL'),
      chalk.bold.cyan('Final Value SOL'),
      chalk.bold.cyan('Net PnL SOL (%)'),
      chalk.bold.cyan('Trades'),
      chalk.bold.cyan('Win Rate'),
      chalk.bold.cyan('Fees Paid SOL')
    ],
    colAligns: ['left', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle'],
    style: { head: [], border: [] }
  });

  const rowData = [simFixed05, simFixed10, simRiskScaled];

  rowData.forEach(res => {
    const pnlColor = res.netProfitSOL >= 0 ? chalk.green : chalk.red;
    const isRecommended = res.strategyName === 'risk_scaled' ? '🌟 ' : '';
    
    let displayName = '';
    if (res.strategyName === 'fixed_0.05') displayName = 'Fixed 0.05 SOL';
    if (res.strategyName === 'fixed_0.10') displayName = 'Fixed 0.10 SOL';
    if (res.strategyName === 'risk_scaled') displayName = 'Risk-Scaled (0.05 - 0.10)';

    table.push([
      `${isRecommended}${chalk.bold(displayName)}`,
      res.startCapital.toFixed(4),
      res.finalValue.toFixed(4),
      pnlColor(`${res.netProfitSOL >= 0 ? '+' : ''}${res.netProfitSOL.toFixed(4)} (${formatPercent(res.netProfitPercent)})`),
      `${res.completedTradesCount} completed / ${res.totalTradesCopied} copied`,
      `${res.winRate.toFixed(1)}% (${res.wins}W - ${res.losses}L)`,
      res.totalFees.toFixed(4)
    ]);
  });

  console.log('\n' + chalk.bold.underline.white('STRATEGY COMPARATIVE REPORT:'));
  console.log(table.toString());

  // 5. Detailed trade log for Recommended Strategy (Risk-Scaled)
  printDetailedLog(simRiskScaled);
}

/**
 * Prints detailed trade history for a simulation result.
 * @param {Object} res - Simulation result object
 */
function printDetailedLog(res) {
  console.log('\n' + chalk.bold.underline.white(`DETAILED TRADE LOG - RISK-SCALED COPY TRADING:`));
  
  if (res.completedTrades.length === 0) {
    console.log(chalk.gray('No completed trades to show.'));
    return;
  }

  const table = new Table({
    head: [
      chalk.bold.yellow('Token Mint'),
      chalk.bold.yellow('Buy Time'),
      chalk.bold.yellow('Sell Time'),
      chalk.bold.yellow('SOL Invested'),
      chalk.bold.yellow('SOL Received'),
      chalk.bold.yellow('PnL SOL'),
      chalk.bold.yellow('PnL %'),
      chalk.bold.yellow('Exit %')
    ],
    colAligns: ['left', 'left', 'left', 'middle', 'middle', 'middle', 'middle', 'middle']
  });

  res.completedTrades.forEach(trade => {
    const pnlColor = trade.netPnL >= 0 ? chalk.green : chalk.red;
    const sign = trade.netPnL >= 0 ? '+' : '';

    table.push([
      formatAddress(trade.tokenMint),
      formatDate(trade.buyTime),
      formatDate(trade.sellTime),
      trade.solInvested.toFixed(4),
      trade.solReceived.toFixed(4),
      pnlColor(`${sign}${trade.netPnL.toFixed(4)}`),
      pnlColor(formatPercent(trade.pnlPercent)),
      `${(trade.sellFraction * 100).toFixed(0)}%`
    ]);
  });

  console.log(table.toString());

  // Print Open holdings
  const openTokens = Object.keys(res.openHoldings);
  if (openTokens.length > 0) {
    console.log('\n' + chalk.bold.cyan(`OPEN HOLDINGS (Unsold Assets):`));
    openTokens.forEach(mint => {
      const h = res.openHoldings[mint];
      console.log(`  - ${chalk.yellow(formatAddress(mint))}: holding ${chalk.bold(h.amount.toLocaleString())} tokens (Cost Basis: ${chalk.green(formatSol(h.solSpent))})`);
    });
  }

  // Print Best/Worst Trades
  if (res.bestTrade) {
    const pColor = res.bestTrade.netPnL >= 0 ? chalk.green : chalk.red;
    console.log('\n' + chalk.bold.green('🏆 BEST TRADE:'));
    console.log(`  Token: ${chalk.yellow(res.bestTrade.tokenMint)}`);
    console.log(`  PnL:   ${pColor(`${res.bestTrade.netPnL >= 0 ? '+' : ''}${res.bestTrade.netPnL.toFixed(4)} SOL (${res.bestTrade.pnlPercent.toFixed(2)}%)`)}`);
  }

  if (res.worstTrade) {
    const pColor = res.worstTrade.netPnL >= 0 ? chalk.green : chalk.red;
    console.log('\n' + chalk.bold.red('💀 WORST TRADE:'));
    console.log(`  Token: ${chalk.yellow(res.worstTrade.tokenMint)}`);
    console.log(`  PnL:   ${pColor(`${res.worstTrade.netPnL >= 0 ? '' : ''}${res.worstTrade.netPnL.toFixed(4)} SOL (${res.worstTrade.pnlPercent.toFixed(2)}%)`)}`);
  }
  
  console.log('\n' + chalk.bold.cyan('Summary:'));
  console.log(`  - Completed trades:  ${res.completedTradesCount}`);
  console.log(`  - Win rate:          ${chalk.bold(res.winRate.toFixed(2))}% (${res.wins} wins / ${res.losses} losses)`);
  console.log(`  - Simulated fees:    ${chalk.red(formatSol(res.totalFees))}`);
  console.log(`  - Net Profit/Loss:   ${res.netProfitSOL >= 0 ? chalk.bold.green(`+${res.netProfitSOL.toFixed(4)} SOL`) : chalk.bold.red(`${res.netProfitSOL.toFixed(4)} SOL`)}`);
  console.log(`  - Final portfolio value: ${chalk.bold.green(formatSol(res.finalValue))} (comprising capital ${formatSol(res.finalCapital)} + assets ${formatSol(res.remainingAssetValue)})`);
  console.log('');
}

main().catch(err => {
  console.error(chalk.red('[UNCAUGHT ERROR]'), err);
  process.exit(1);
});
