/**
 * Shared in-memory caches to eliminate repeated RPC calls per trade.
 * Blockhash is refreshed every 300ms (Solana produces blocks ~every 400ms).
 * Wallet balances cached for 1s (plenty fresh for pre-checks).
 */
import { Connection } from '@solana/web3.js';

let _connection = null;
let _blockhash = null;
let _blockhashAge = 0;
const _balanceCache = new Map(); // address -> { lamports, ts }

function getConnection() {
  if (!_connection) {
    _connection = new Connection(
      process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
  }
  return _connection;
}

export async function getCachedBlockhash() {
  const now = Date.now();
  if (!_blockhash || now - _blockhashAge > 300) {
    const res = await getConnection().getLatestBlockhash('confirmed');
    _blockhash = res.blockhash;
    _blockhashAge = now;
  }
  return _blockhash;
}

export async function getCachedBalance(address) {
  const key = address.toString();
  const now = Date.now();
  const cached = _balanceCache.get(key);
  if (cached && now - cached.ts < 1000) return cached.lamports;
  const lamports = await getConnection().getBalance(address);
  _balanceCache.set(key, { lamports, ts: now });
  return lamports;
}

export function invalidateBalance(address) {
  _balanceCache.delete(address.toString());
}
