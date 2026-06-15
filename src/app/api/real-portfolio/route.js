import { NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { getRealHoldings, getRealTrades, initDb } from '../../../lib/db.js';
import { getTokenMetadata } from '../../../lib/token.js';

export async function GET(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const walletAddress = searchParams.get('wallet');

    if (!walletAddress) {
      return NextResponse.json({ success: false, error: 'Wallet address is required.' }, { status: 400 });
    }

    // 1. Fetch live SOL balance from the blockchain
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    
    let balanceSol = 0.0;
    try {
      const pubkey = new PublicKey(walletAddress);
      const balance = await connection.getBalance(pubkey);
      balanceSol = balance / 1e9;
    } catch (err) {
      console.warn(`[REAL PORTFOLIO] Failed to fetch balance for ${walletAddress}:`, err.message);
    }

    // 2. Fetch real holdings from the database
    const rawHoldings = await getRealHoldings(walletAddress);
    const enrichedHoldings = await Promise.all(
      rawHoldings.map(async (h) => {
        const meta = await getTokenMetadata(h.mint);
        return {
          ...h,
          symbol: meta.symbol,
          name: meta.name
        };
      })
    );

    // 3. Fetch real completed trades from the database
    const rawTrades = await getRealTrades(walletAddress);
    const enrichedTrades = await Promise.all(
      rawTrades.map(async (t) => {
        const meta = await getTokenMetadata(t.tokenMint);
        return {
          ...t,
          symbol: meta.symbol,
          name: meta.name
        };
      })
    );

    return NextResponse.json({
      success: true,
      balance: balanceSol,
      holdings: enrichedHoldings,
      trades: enrichedTrades
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
