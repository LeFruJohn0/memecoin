import { formatSol, formatPercent, formatDate, formatAddress } from './utils.js';

/**
 * Runs a copy-trading simulation for a specific strategy on a list of swaps.
 * @param {Array<Object>} swaps - Chronological swap events
 * @param {string} strategyName - Name of the strategy ('fixed_0.05', 'fixed_0.10', or 'risk_scaled')
 * @param {Object} options - Config options (startCapital, minCopySize, maxCopySize, txFeeSol)
 * @returns {Object} Simulation results
 */
export function runSimulation(swaps, strategyName, options) {
  const { startCapital, minCopySize, maxCopySize, txFeeSol, minTargetEntrySize = 0.9 } = options;
  
  let capital = startCapital;
  let holdings = {}; // key: tokenMint, value: { amount: 0, solSpent: 0 }
  let completedTrades = [];
  let totalFees = 0;
  let totalTradesCopied = 0;
  
  // Sort swaps chronologically (oldest blockTime first)
  const sortedSwaps = [...swaps].sort((a, b) => a.blockTime - b.blockTime);

  for (const swap of sortedSwaps) {
    const { type, tokenMint, solAmount, tokenAmount, walletSolBalanceBefore, blockTime, txHash } = swap;

    if (type === 'buy') {
      // Rule: Only copy buy trades where target entry is >= minTargetEntrySize SOL
      if (solAmount < minTargetEntrySize) continue;

      // Calculate copy size based on strategy
      let copySize = 0.05;
      if (strategyName === 'fixed_0.05') {
        copySize = 0.05;
      } else if (strategyName === 'fixed_0.10') {
        copySize = 0.10;
      } else if (strategyName === 'risk_scaled') {
        // Target's risk relative to their SOL balance before buying
        const targetRiskRatio = solAmount / (walletSolBalanceBefore || 1.0);
        // Scale the risk against user's initial capital (1.0 SOL)
        const rawSize = targetRiskRatio * startCapital;
        // Clamp between min and max copy size
        copySize = Math.max(minCopySize, Math.min(maxCopySize, rawSize));
      }

      // Check if we have enough capital (including the tx fee)
      if (capital < copySize + txFeeSol) {
        // Log skip due to insufficient capital
        continue;
      }

      // Execute buy at the same exchange rate (tokens per SOL)
      const entryPrice = solAmount / tokenAmount; // SOL per token
      const tokensBought = copySize / entryPrice;

      // Update capital and holdings
      capital -= (copySize + txFeeSol);
      totalFees += txFeeSol;
      totalTradesCopied++;

      if (!holdings[tokenMint]) {
        holdings[tokenMint] = {
          amount: 0,
          solSpent: 0,
          entries: []
        };
      }

      holdings[tokenMint].amount += tokensBought;
      holdings[tokenMint].solSpent += copySize;
      holdings[tokenMint].entries.push({
        time: blockTime,
        price: entryPrice,
        amount: tokensBought,
        solSpent: copySize,
        txHash
      });
    } 
    
    else if (type === 'sell') {
      // Check if we hold this token
      const holding = holdings[tokenMint];
      if (!holding || holding.amount <= 0) continue;

      // Rule: Fully exit the trade (sell 100%) when the target sells even a tiny fraction of the memecoin
      const sellFraction = 1.0;
      const tokensToSell = holding.amount;
      if (tokensToSell <= 0) continue;

      // Execute sell at the same exchange rate
      const exitPrice = solAmount / tokenAmount; // SOL per token
      const solReceived = tokensToSell * exitPrice;

      // Cost basis of the sold fraction
      const costBasis = holding.solSpent * sellFraction;
      const grossPnL = solReceived - costBasis;
      const netPnL = grossPnL - txFeeSol;
      const pnlPercent = (grossPnL / costBasis) * 100;

      // Update capital and holdings
      capital += (solReceived - txFeeSol);
      totalFees += txFeeSol;

      // Log the completed trade
      completedTrades.push({
        tokenMint,
        buyTime: holding.entries[0]?.time || blockTime,
        sellTime: blockTime,
        solInvested: costBasis,
        solReceived,
        netPnL,
        pnlPercent,
        sellFraction,
        buyHash: holding.entries[0]?.txHash || 'N/A',
        sellHash: txHash
      });

      // Update holdings record
      holding.amount -= tokensToSell;
      holding.solSpent -= costBasis;

      // If fully sold or amount is negligible, remove from holdings
      if (holding.amount < 1e-8 || sellFraction === 1.0) {
        delete holdings[tokenMint];
      }
    }
  }

  // Calculate value of remaining assets (unsold holdings at their cost basis)
  let remainingAssetValue = 0;
  for (const mint in holdings) {
    remainingAssetValue += holdings[mint].solSpent;
  }

  // Compile final performance statistics
  const finalValue = capital + remainingAssetValue;
  const netProfitSOL = finalValue - startCapital;
  const netProfitPercent = (netProfitSOL / startCapital) * 100;
  
  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  const losses = completedTrades.length - wins;
  const winRate = completedTrades.length > 0 ? (wins / completedTrades.length) * 100 : 0;
  
  let bestTrade = null;
  let worstTrade = null;
  
  if (completedTrades.length > 0) {
    bestTrade = [...completedTrades].sort((a, b) => b.pnlPercent - a.pnlPercent)[0];
    worstTrade = [...completedTrades].sort((a, b) => a.pnlPercent - b.pnlPercent)[0];
  }

  return {
    strategyName,
    startCapital,
    finalCapital: capital,
    remainingAssetValue,
    finalValue,
    netProfitSOL,
    netProfitPercent,
    totalTradesCopied,
    completedTradesCount: completedTrades.length,
    wins,
    losses,
    winRate,
    totalFees,
    bestTrade,
    worstTrade,
    completedTrades,
    openHoldings: holdings
  };
}
