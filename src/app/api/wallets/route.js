import { NextResponse } from 'next/server';
import { initDb, getWallets, addWallet, deleteWallet } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    const wallets = await getWallets();
    return NextResponse.json({ success: true, wallets });
  } catch (err) {
    console.error('[WALLETS API ERROR] GET failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await initDb();
    const { address, name } = await req.json();
    
    if (!address || !name) {
      return NextResponse.json(
        { success: false, error: 'Address and Name/Nickname are required.' }, 
        { status: 400 }
      );
    }
    
    // Normalize address length and structure
    const trimmedAddress = address.trim();
    if (trimmedAddress.length < 32 || trimmedAddress.length > 44) {
      return NextResponse.json(
        { success: false, error: 'Invalid Solana wallet public key length.' },
        { status: 400 }
      );
    }

    await addWallet(trimmedAddress, name.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WALLETS API ERROR] POST failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address');
    
    if (!address) {
      return NextResponse.json({ success: false, error: 'Wallet address is required.' }, { status: 400 });
    }
    
    await deleteWallet(address);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[WALLETS API ERROR] DELETE failed:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
