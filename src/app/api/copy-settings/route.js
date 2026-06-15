import { NextResponse } from 'next/server';
import { getCopySettings, saveCopySetting, deleteCopySetting, initDb } from '../../../lib/db.js';

export async function GET() {
  try {
    await initDb();
    const settings = await getCopySettings();
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    await initDb();
    const { targetWallet, executionWallet, copySize, slippageBps, isActive } = await req.json();

    if (!targetWallet || !executionWallet || copySize === undefined) {
      return NextResponse.json({ success: false, error: 'Target wallet, execution wallet, and copy size are required.' }, { status: 400 });
    }

    const size = parseFloat(copySize);
    if (isNaN(size) || size <= 0) {
      return NextResponse.json({ success: false, error: 'Copy size must be a positive number.' }, { status: 400 });
    }

    const slippage = slippageBps ? parseInt(slippageBps, 10) : 1000;
    const active = isActive !== false; // defaults to true

    await saveCopySetting(targetWallet, executionWallet, size, slippage, active);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const targetWallet = searchParams.get('targetWallet');
    const executionWallet = searchParams.get('executionWallet');

    if (!targetWallet || !executionWallet) {
      return NextResponse.json({ success: false, error: 'Target wallet and execution wallet parameters are required.' }, { status: 400 });
    }

    await deleteCopySetting(targetWallet, executionWallet);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
