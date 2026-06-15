import { NextResponse } from 'next/server';
import { getExecutionWallets, addExecutionWallet, deleteExecutionWallet, initDb } from '../../../lib/db.js';
import { validateAndDeriveAddress, encrypt } from '../../../lib/crypto.js';

export async function GET() {
  try {
    await initDb();
    const wallets = await getExecutionWallets();
    // Safety: Omit encrypted private keys from listing responses
    const sanitizedWallets = wallets.map(w => ({
      address: w.address,
      name: w.name
    }));
    return NextResponse.json({ success: true, wallets: sanitizedWallets });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await initDb();
    const { privateKey, name } = await req.json();

    if (!privateKey || !name) {
      return NextResponse.json({ success: false, error: 'Private key and name are required.' }, { status: 400 });
    }

    // 1. Validate the Base58 private key and extract the public address
    let address;
    try {
      address = validateAndDeriveAddress(privateKey);
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }

    // 2. Encrypt the private key securely using AES-256-GCM
    const encryptedKey = encrypt(privateKey.trim());

    // 3. Save to database
    await addExecutionWallet(address, name.trim(), encryptedKey);

    return NextResponse.json({ 
      success: true, 
      wallet: { address, name: name.trim() } 
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ success: false, error: 'Address is required.' }, { status: 400 });
    }

    await deleteExecutionWallet(address);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
