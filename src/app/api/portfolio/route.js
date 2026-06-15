import { NextResponse } from 'next/server';
import { initDb, getPortfolio, getHoldings, getTrades } from '../../../lib/db.js';
import { getTokenMetadata } from '../../../lib/token.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet address is required.' }, { status: 400 });
    }

    const portfolio = await getPortfolio(wallet);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: `Simulated portfolio not found for wallet: ${wallet}. Please verify if this wallet is tracked.` }, { status: 404 });
    }

    const holdings = await getHoldings(wallet);
    const trades = await getTrades(wallet);

    // Enrich holdings and trades with token name and symbol
    const enrichedHoldings = await Promise.all(holdings.map(async (h) => {
      const meta = await getTokenMetadata(h.mint);
      return { ...h, tokenSymbol: meta.symbol, tokenName: meta.name };
    }));

    const enrichedTrades = await Promise.all(trades.map(async (t) => {
      const meta = await getTokenMetadata(t.tokenMint);
      return { ...t, tokenSymbol: meta.symbol, tokenName: meta.name };
    }));

    return NextResponse.json({
      success: true,
      portfolio,
      holdings: enrichedHoldings,
      trades: enrichedTrades
    });
  } catch (err) {
    console.error('[PORTFOLIO API ERROR] GET failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

