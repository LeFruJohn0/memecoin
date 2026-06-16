import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { initDb, getWallets, getPortfolio, updatePortfolio, getHoldings, saveHolding, deleteHolding, addTrade, markSignatureProcessed } from '../../../lib/db.js';
import { getTransactionWithRetry, parseTransactionSwaps, parseSwapFromHeliusPayload } from '../../../../cli/parser.js';
import { executeRealCopyTrades } from '../../../lib/execution.js';

const txFeeSol = 0.0005;

async function processSwaps(swaps, targetWallet, signature, blockTime, connection) {
  for (const swap of swaps) {
    const { type, tokenMint, solAmount, tokenAmount, walletSolBalanceBefore } = swap;

    const portfolio = await getPortfolio(targetWallet.address);
    if (!portfolio) continue;

    if (type === 'buy') {
      const minTargetEntrySize = parseFloat(process.env.MIN_TARGET_ENTRY_SIZE || '0.9');
      if (solAmount < minTargetEntrySize) {
        console.log(`[WEBHOOK] Skipped BUY [${tokenMint.slice(0,6)}] — ${solAmount.toFixed(4)} SOL under threshold`);
        continue;
      }

      const startCapital = parseFloat(process.env.START_CAPITAL || '1.0');
      const minCopySize = parseFloat(process.env.MIN_COPY_SIZE || '0.05');
      const maxCopySize = parseFloat(process.env.MAX_COPY_SIZE || '0.10');
      const targetRiskRatio = solAmount / (walletSolBalanceBefore || 1.0);
      const copySize = Math.max(minCopySize, Math.min(maxCopySize, targetRiskRatio * startCapital));

      if (portfolio.capital < copySize + txFeeSol) {
        console.warn(`[WEBHOOK] Skipped BUY [${tokenMint.slice(0,6)}] — insufficient capital`);
        continue;
      }

      const entryPrice = solAmount / tokenAmount;
      const tokensBought = copySize / entryPrice;
      const entryTime = blockTime ? blockTime * 1000 : Date.now();

      await updatePortfolio(targetWallet.address, portfolio.capital - copySize - txFeeSol, portfolio.totalFees + txFeeSol);

      const holdings = await getHoldings(targetWallet.address);
      let holding = holdings.find(h => h.mint === tokenMint) || { mint: tokenMint, amount: 0, solSpent: 0, entryPrice, entryTime };
      holding.amount += tokensBought;
      holding.solSpent += copySize;
      holding.entryPrice = holding.solSpent / holding.amount;
      holding.entryTime = entryTime;
      await saveHolding(targetWallet.address, holding.mint, holding.amount, holding.solSpent, holding.entryPrice, holding.entryTime);

      console.log(`[WEBHOOK] BUY [${tokenMint.slice(0,6)}] ${copySize.toFixed(4)} SOL`);

    } else if (type === 'sell') {
      const holdings = await getHoldings(targetWallet.address);
      const holding = holdings.find(h => h.mint === tokenMint);
      if (!holding || holding.amount <= 0) continue;

      const exitPrice = solAmount / tokenAmount;
      const solReceived = holding.amount * exitPrice;
      const netPnL = solReceived - holding.solSpent - txFeeSol;
      const pnlPercent = ((solReceived - holding.solSpent) / holding.solSpent) * 100;

      await updatePortfolio(targetWallet.address, portfolio.capital + solReceived - txFeeSol, portfolio.totalFees + txFeeSol);
      await addTrade(targetWallet.address, {
        tokenMint,
        buyTime: holding.entryTime,
        sellTime: blockTime ? blockTime * 1000 : Date.now(),
        solInvested: holding.solSpent,
        solReceived,
        netPnL,
        pnlPercent,
        buyHash: 'N/A',
        sellHash: signature
      });
      await deleteHolding(targetWallet.address, tokenMint);

      console.log(`[WEBHOOK] SELL [${tokenMint.slice(0,6)}] PnL: ${netPnL.toFixed(4)} SOL (${pnlPercent.toFixed(2)}%)`);
    }

    // Trigger live execution (fire-and-forget, don't block swap loop)
    executeRealCopyTrades(swap, targetWallet.address).catch(err =>
      console.error(`[WEBHOOK] executeRealCopyTrades error: ${err.message}`)
    );
  }
}

export async function POST(req) {
  try {
    await initDb();

    const payload = await req.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      return NextResponse.json({ success: true, message: 'Empty payload.' });
    }

    const trackedWallets = await getWallets();
    if (trackedWallets.length === 0) {
      return NextResponse.json({ success: true, message: 'No tracked wallets.' });
    }

    // Respond to Helius immediately — process everything in background
    (async () => {
      const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');

      for (const txData of payload) {
        const { signature } = txData;
        if (!signature) continue;

        const isNew = await markSignatureProcessed(signature);
        if (!isNew) {
          console.log(`[WEBHOOK] Duplicate: ${signature}`);
          continue;
        }

        const targetWallet = trackedWallets.find(w =>
          txData.feePayer === w.address ||
          txData.accountData?.some(acc => acc.account === w.address)
        );
        if (!targetWallet) continue;

        console.log(`[WEBHOOK] ${targetWallet.name} | ${signature}`);

        // Fast path: parse directly from Helius payload (no RPC fetch)
        let swaps = parseSwapFromHeliusPayload(txData, targetWallet.address);
        let blockTime = txData.timestamp;

        // Slow path fallback: fetch full tx from RPC if Helius payload lacks token data
        if (!swaps) {
          console.log(`[WEBHOOK] Helius payload incomplete, fetching from RPC...`);
          const tx = await getTransactionWithRetry(connection, signature);
          if (!tx) { console.warn(`[WEBHOOK] Could not fetch tx: ${signature}`); continue; }
          swaps = parseTransactionSwaps(tx, targetWallet.address);
          blockTime = tx.blockTime;
        }

        if (!swaps) { console.log(`[WEBHOOK] Not a swap, skipping.`); continue; }

        await processSwaps(swaps, targetWallet, signature, blockTime, connection);
      }
    })().catch(err => console.error('[WEBHOOK BACKGROUND ERROR]', err.message));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
