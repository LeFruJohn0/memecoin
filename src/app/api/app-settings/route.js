import { NextResponse } from 'next/server';
import { getAppSetting, setAppSetting, initDb } from '../../../lib/db.js';
import { encrypt, decrypt } from '../../../lib/crypto.js';

// GET /api/app-settings?key=pumpdev_api_key
// Returns whether the key is configured (never returns the decrypted value)
export async function GET(req) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (!key) return NextResponse.json({ success: false, error: 'key param required' }, { status: 400 });

    const encrypted = await getAppSetting(key);
    return NextResponse.json({ success: true, configured: !!encrypted });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/app-settings  { key, value }
// Encrypts and stores the value
export async function POST(req) {
  try {
    await initDb();
    const { key, value } = await req.json();
    if (!key || !value) {
      return NextResponse.json({ success: false, error: 'key and value are required' }, { status: 400 });
    }

    const encryptedValue = encrypt(value.trim());
    await setAppSetting(key, encryptedValue);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
