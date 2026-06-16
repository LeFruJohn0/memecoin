import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { initDb, getWallets, getPortfolio, updatePortfolio, getHoldings, saveHolding, deleteHolding, addTrade, markSignatureProcessed } from '../../../lib/db.js';
import { getTransactionWithRetry, parseTransactionSwaps } from '../../../../cli/parser.js';
import { executeRealCopyTrades } from '../../../lib/execution.js';

export async function POST(req) {
  try {
    await initDb();
    
    // Webhook payload is typically an array of transactions from Helius
    const payload = await req.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      return NextResponse.json({ success: true, message: 'Empty or invalid webhook payload.' });
    }

    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Get all tracked wallets
    const trackedWallets = await getWallets();
    if (trackedWallets.length === 0) {
      return NextResponse.json({ success: true, message: 'No wallets currently being tracked. Webhook skipped.' });
    }

    const txFeeSol = 0.0005; // Standard fee

    // Respond to Helius immediately to prevent timeout retries, process trades in background
    const processingPromise = (async () => {
    for (const txData of payload) {
      const { signature } = txData;
      if (!signature) continue;

      // Deduplicate: skip if this signature was already processed (Helius at-least-once delivery)
      const isNew = await markSignatureProcessed(signature);
      if (!isNew) {
        console.log(`[WEBHOOK] Duplicate signature detected, skipping: ${signature}`);
        continue;
      }

      // Find which of our tracked wallets is involved in the transaction accounts or feepayer
      const targetWallet = trackedWallets.find(w => {
        return txData.feePayer === w.address || 
               txData.accountData?.some(acc => acc.account === w.address);
      });

      if (!targetWallet) {
        // Transaction does not involve any of our tracked wallets
        continue;
      }

      console.log(`[WEBHOOK] Processing transaction for tracked wallet "${targetWallet.name}" (${targetWallet.address}) | Signature: ${signature}`);

      // Fetch the transaction details using our verified rate-limit retry logic
      const tx = await getTransactionWithRetry(connection, signature);
      if (!tx) {
        console.warn(`[WEBHOOK] Could not retrieve transaction details for signature: ${signature}`);
        continue;
      }

      // Parse the swap event details using our CLI parser
      const swaps = parseTransactionSwaps(tx, targetWallet.address);
      if (!swaps) {
        console.log(`[WEBHOOK] Transaction is not a parsed SOL/Token swap. Skipping.`);
        continue;
      }

      for (const swap of swaps) {
        const { type, tokenMint, solAmount, tokenAmount, walletSolBalanceBefore, preTokenAmount, postTokenAmount } = swap;
        
        // Retrieve target wallet's isolated portfolio state
        const portfolio = await getPortfolio(targetWallet.address);
        if (!portfolio) continue;

        if (type === 'buy') {
          const minTargetEntrySize = parseFloat(process.env.MIN_TARGET_ENTRY_SIZE || '0.9');

          // Rule: Copy trade only if the target entry is >= minTargetEntrySize SOL
          if (solAmount < minTargetEntrySize) {
            console.log(`[WEBHOOK] Skipped BUY of [${tokenMint.slice(0,6)}] - spent ${solAmount.toFixed(4)} SOL (Under ${minTargetEntrySize} SOL threshold)`);
            continue;
          }

          // Fetch user config for copy trade limits (using current environment variables)
          const startCapital = parseFloat(process.env.START_CAPITAL || '1.0');
          const minCopySize = parseFloat(process.env.MIN_COPY_SIZE || '0.05');
          const maxCopySize = parseFloat(process.env.MAX_COPY_SIZE || '0.10');

          // Risk-Scaled position sizing
          const targetRiskRatio = solAmount / (walletSolBalanceBefore || 1.0);
          const rawSize = targetRiskRatio * startCapital;
          const copySize = Math.max(minCopySize, Math.min(maxCopySize, rawSize));

          // Check simulated capital
          if (portfolio.capital < copySize + txFeeSol) {
            console.warn(`[WEBHOOK] Skipped BUY of [${tokenMint.slice(0,6)}] - Insufficient simulated capital (Needs ${copySize.toFixed(4)} SOL, Has ${portfolio.capital.toFixed(4)} SOL)`);
            continue;
          }

          const entryPrice = solAmount / tokenAmount;
          const tokensBought = copySize / entryPrice;

          // Deduct capital
          const newCapital = portfolio.capital - (copySize + txFeeSol);
          const newFees = portfolio.totalFees + txFeeSol;
          await updatePortfolio(targetWallet.address, newCapital, newFees);

          // Update holdings
          const holdings = await getHoldings(targetWallet.address);
          let holding = holdings.find(h => h.mint === tokenMint);

          if (!holding) {
            holding = {
              mint: tokenMint,
              amount: 0,
              solSpent: 0,
              entryPrice: entryPrice,
              entryTime: tx.blockTime ? tx.blockTime * 1000 : Date.now()
            };
          }

          holding.amount += tokensBought;
          holding.solSpent += copySize;
          holding.entryPrice = holding.solSpent / holding.amount; // update average entry price
          holding.entryTime = tx.blockTime ? tx.blockTime * 1000 : Date.now();

          await saveHolding(targetWallet.address, holding.mint, holding.amount, holding.solSpent, holding.entryPrice, holding.entryTime);

          console.log(`[WEBHOOK] COPIED BUY SUCCESSFUL! Bought ${tokensBought.toLocaleString()} of token [${tokenMint.slice(0,6)}] for ${copySize.toFixed(4)} SOL.`);
        } 
        
        else if (type === 'sell') {
          // Retrieve holdings
          const holdings = await getHoldings(targetWallet.address);
          const holding = holdings.find(h => h.mint === tokenMint);

          if (!holding || holding.amount <= 0) {
            console.log(`[WEBHOOK] Target sold [${tokenMint.slice(0,6)}], but we do not hold this token. Skipping exit.`);
            continue;
          }

          // Rule: Fully exit the trade (sell 100%) when the target sells even a tiny fraction of the memecoin
          const sellFraction = 1.0;
          const tokensToSell = holding.amount;
          if (tokensToSell <= 0) continue;

          const exitPrice = solAmount / tokenAmount;
          const solReceived = tokensToSell * exitPrice;
          const costBasis = holding.solSpent * sellFraction;
          const netPnL = solReceived - costBasis - txFeeSol;
          const pnlPercent = ((solReceived - costBasis) / costBasis) * 100;

          // Add proceeds to capital
          const newCapital = portfolio.capital + (solReceived - txFeeSol);
          const newFees = portfolio.totalFees + txFeeSol;
          await updatePortfolio(targetWallet.address, newCapital, newFees);

          // Save completed trade to log
          await addTrade(targetWallet.address, {
            tokenMint,
            buyTime: holding.entryTime,
            sellTime: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
            solInvested: costBasis,
            solReceived,
            netPnL,
            pnlPercent,
            sellFraction,
            buyHash: 'N/A', // Webhook only tracks signature of sell
            sellHash: signature
          });

          // Update holding
          holding.amount -= tokensToSell;
          holding.solSpent -= costBasis;

          if (holding.amount < 1e-8 || sellFraction === 1.0) {
            await deleteHolding(targetWallet.address, tokenMint);
          } else {
            await saveHolding(targetWallet.address, tokenMint, holding.amount, holding.solSpent, holding.entryPrice, holding.entryTime);
          }

          console.log(`[WEBHOOK] COPIED SELL SUCCESSFUL! Sold ${(sellFraction*100).toFixed(0)}% of [${tokenMint.slice(0,6)}] | PnL: ${netPnL.toFixed(4)} SOL (${pnlPercent.toFixed(2)}%)`);
        }

        // Trigger on-chain copier to execute real trades
        await executeRealCopyTrades(swap, targetWallet.address);
      }
    }

    }
    })(); // end background processing closure

    // Fire-and-forget: don't await so Helius gets an immediate 200
    processingPromise.catch(err => console.error('[WEBHOOK BACKGROUND ERROR]', err.message));

    return NextResponse.json({ success: true, message: 'Webhook received.' });
  } catch (err) {
    console.error('[WEBHOOK API ERROR] POST failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
