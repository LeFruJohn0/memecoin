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
    const { targetWallet, executionWallet, minCopySize, maxCopySize, slippageBps, isActive } = await req.json();

    if (!targetWallet || !executionWallet || minCopySize === undefined || maxCopySize === undefined) {
      return NextResponse.json({ success: false, error: 'Target wallet, execution wallet, min size, and max size are required.' }, { status: 400 });
    }

    const min = parseFloat(minCopySize);
    const max = parseFloat(maxCopySize);
    if (isNaN(min) || min <= 0) return NextResponse.json({ success: false, error: 'Min size must be a positive number.' }, { status: 400 });
    if (isNaN(max) || max <= 0) return NextResponse.json({ success: false, error: 'Max size must be a positive number.' }, { status: 400 });
    if (min > max) return NextResponse.json({ success: false, error: 'Min size cannot be greater than max size.' }, { status: 400 });

    const slippage = slippageBps ? parseInt(slippageBps, 10) : 1000;
    const active = isActive !== false;

    await saveCopySetting(targetWallet, executionWallet, min, min, max, slippage, active);
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
