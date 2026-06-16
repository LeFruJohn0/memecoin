/**
 * PumpDev fallback (for graduated tokens) + Jito bundle submission.
 * For bonding curve tokens, pumpfun.js builds the tx locally (faster).
 * PumpDev is only used when pumpfun.js throws 'GRADUATED'.
 */
import {
  Keypair, VersionedTransaction, PublicKey, Transaction, SystemProgram
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getAppSetting } from './db.js';
import { decrypt } from './crypto.js';
import { getCachedBlockhash } from './cache.js';

const PUMPDEV_API   = 'https://pumpdev.io/api/trade-local';
const JITO_ENDPOINT = 'https://mainnet.block-engine.jito.labs.io/api/v1/bundles';
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt13X5U8YS',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

async function getPumpDevApiKey() {
  try {
    const encrypted = await getAppSetting('pumpdev_api_key');
    if (encrypted) return decrypt(encrypted);
  } catch { /* fall through */ }
  const envKey = process.env.PUMPDEV_API_KEY;
  if (envKey && envKey !== 'REPLACE_WITH_YOUR_REGENERATED_KEY') return envKey;
  throw new Error('PumpDev API key not configured.');
}

/** Fallback for graduated tokens — builds tx via PumpDev HTTP API. */
export async function buildPumpDevTransaction({
  publicKey, action, mint, amount,
  denominatedInSol = true, slippagePct = 10, priorityFeeSol = 0.003
}) {
  const apiKey = await getPumpDevApiKey();
  const res = await fetch(PUMPDEV_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      publicKey, action, mint, amount,
      denominatedInSol: denominatedInSol.toString(),
      slippage: slippagePct,
      priorityFee: priorityFeeSol,
      pool: 'auto'
    })
  });
  if (!res.ok) throw new Error(`PumpDev API failed: ${await res.text()}`);
  const buf = await res.arrayBuffer();
  // Deserialize and return as Transaction-like object for sendViaJito
  return { _base64: Buffer.from(buf).toString('base64'), _isVersioned: true };
}

/**
 * Submits a trade + tip as a Jito bundle.
 * Accepts either a signed Transaction (from pumpfun.js) or a base64 VersionedTransaction (from PumpDev).
 * Returns the trade signature immediately — no confirmation wait.
 */
export async function sendViaJito(signedTxOrPumpDevResult, keypair, connection, tipLamports = 100_000) {
  let tradeTxBase58, tradeSignature;

  if (signedTxOrPumpDevResult._isVersioned) {
    // PumpDev path: VersionedTransaction, sign it
    const vtx = VersionedTransaction.deserialize(Buffer.from(signedTxOrPumpDevResult._base64, 'base64'));
    vtx.sign([keypair]);
    tradeSignature = bs58.encode(vtx.signatures[0]);
    tradeTxBase58  = bs58.encode(vtx.serialize());
  } else {
    // pumpfun.js path: Legacy Transaction, already signed
    const serialized = signedTxOrPumpDevResult.serialize();
    tradeSignature   = bs58.encode(signedTxOrPumpDevResult.signature);
    tradeTxBase58    = bs58.encode(serialized);
  }

  // Build tip transaction using cached blockhash
  const blockhash = await getCachedBlockhash();
  const tipAccount = new PublicKey(
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
  );
  const tipTx = new Transaction();
  tipTx.recentBlockhash = blockhash;
  tipTx.feePayer = keypair.publicKey;
  tipTx.add(SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: tipAccount,
    lamports: tipLamports
  }));
  tipTx.sign(keypair);
  const tipTxBase58 = bs58.encode(tipTx.serialize());

  // Submit bundle
  const res = await fetch(JITO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'sendBundle',
      params: [[tradeTxBase58, tipTxBase58]]
    })
  });
  const json = await res.json();
  if (json.error) throw new Error(`Jito error: ${json.error.message}`);

  console.log(`[JITO] Bundle sent. Sig: ${tradeSignature}`);
  return tradeSignature;
}

/** Poll for token balance after a buy (gives tx time to land). */
export async function getTokenBalanceForWallet(connection, walletAddress, mint, decimals = 9) {
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 600));
    try {
      const accounts = await connection.getTokenAccountsByOwner(
        new PublicKey(walletAddress), { mint: new PublicKey(mint) }
      );
      if (!accounts.value.length) continue;
      const bal = await connection.getTokenAccountBalance(accounts.value[0].pubkey);
      const amount = parseInt(bal.value.amount, 10);
      if (amount > 0) return amount / (10 ** decimals);
    } catch { /* retry */ }
  }
  return 0;
}
