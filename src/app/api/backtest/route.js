import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getTransactionWithRetry, parseTransactionSwaps } from '../../../../cli/parser.js';
import { runSimulation } from '../../../../cli/simulator.js';
import { getTokenMetadata } from '../../../lib/token.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const walletStr = searchParams.get('wallet');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    if (!walletStr) {
      return NextResponse.json({ success: false, error: 'Wallet address parameter is required.' }, { status: 400 });
    }

    let walletKey;
    try {
      walletKey = new PublicKey(walletStr);
    } catch (err) {
      return NextResponse.json({ success: false, error: 'Invalid Solana wallet address.' }, { status: 400 });
    }

    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // 1. Fetch transaction signatures for target wallet address
    let signatures = [];
    let lastSig = null;
    while (signatures.length < limit) {
      const fetchLimit = Math.min(100, limit - signatures.length);
      const options = { limit: fetchLimit };
      if (lastSig) options.before = lastSig;

      const sigs = await connection.getSignaturesForAddress(walletKey, options);
      if (sigs.length === 0) break;

      signatures.push(...sigs);
      lastSig = sigs[sigs.length - 1].signature;

      if (sigs.length < fetchLimit) break;
    }

    if (signatures.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No transaction signatures found for this wallet.',
        results: null
      });
    }

    // 2. Fetch transaction details and parse buy/sell swaps
    const swaps = [];
    for (const sigInfo of signatures) {
      if (sigInfo.err) continue;
      try {
        const tx = await getTransactionWithRetry(connection, sigInfo.signature);
        if (tx) {
          const parsedSwaps = parseTransactionSwaps(tx, walletStr);
          if (parsedSwaps) {
            swaps.push(...parsedSwaps);
          }
        }
      } catch (err) {
        // Log query errors but continue backtesting remaining signatures
        console.warn(`[BACKTEST] Skipping signature ${sigInfo.signature}:`, err.message);
      }
    }

    if (swaps.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No swap events detected in the fetched signatures (all transactions skipped or non-swaps).',
        results: null
      });
    }

    // 3. Configure backtest parameters
    const startCapital = parseFloat(process.env.START_CAPITAL || '1.0');
    const minCopySize = parseFloat(process.env.MIN_COPY_SIZE || '0.05');
    const maxCopySize = parseFloat(process.env.MAX_COPY_SIZE || '0.10');
    const minTargetEntrySize = parseFloat(process.env.MIN_TARGET_ENTRY_SIZE || '0.9');
    const txFeeSol = 0.0005; // Standard fee

    const opt = {
      startCapital,
      minCopySize,
      maxCopySize,
      txFeeSol,
      minTargetEntrySize
    };

    // Run strategy backtests
    const simFixed05 = runSimulation(swaps, 'fixed_0.05', opt);
    const simFixed10 = runSimulation(swaps, 'fixed_0.10', opt);
    const simRiskScaled = runSimulation(swaps, 'risk_scaled', opt);

    // Helper to resolve token metadata for simulation reports
    async function enrichSim(sim) {
      if (!sim) return sim;
      
      const completedTradesEnriched = await Promise.all(sim.completedTrades.map(async (t) => {
        const meta = await getTokenMetadata(t.tokenMint);
        return { ...t, tokenSymbol: meta.symbol, tokenName: meta.name };
      }));
      
      let bestTradeEnriched = null;
      if (sim.bestTrade) {
        const meta = await getTokenMetadata(sim.bestTrade.tokenMint);
        bestTradeEnriched = { ...sim.bestTrade, tokenSymbol: meta.symbol, tokenName: meta.name };
      }

      let worstTradeEnriched = null;
      if (sim.worstTrade) {
        const meta = await getTokenMetadata(sim.worstTrade.tokenMint);
        worstTradeEnriched = { ...sim.worstTrade, tokenSymbol: meta.symbol, tokenName: meta.name };
      }

      return {
        ...sim,
        completedTrades: completedTradesEnriched,
        bestTrade: bestTradeEnriched,
        worstTrade: worstTradeEnriched
      };
    }

    const enrichedFixed05 = await enrichSim(simFixed05);
    const enrichedFixed10 = await enrichSim(simFixed10);
    const enrichedRiskScaled = await enrichSim(simRiskScaled);

    return NextResponse.json({
      success: true,
      results: {
        fixed05: enrichedFixed05,
        fixed10: enrichedFixed10,
        riskScaled: enrichedRiskScaled
      }
    });
  } catch (err) {
    console.error('[BACKTEST API ERROR] failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
export const maxDuration = 60; // Extend Vercel function timeout if possible (up to 60s)
