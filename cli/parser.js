import { sleep } from './utils.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Fetches transaction details with exponential backoff on 429 rate limits.
 * @param {Connection} connection - Solana RPC connection
 * @param {string} signature - Transaction signature
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<ParsedTransactionWithMeta|null>}
 */
export async function getTransactionWithRetry(connection, signature, maxRetries = 6) {
  let delay = 1000;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Small throttle delay between requests to keep connection stable
      await sleep(150);
      
      const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });
      
      if (tx) return tx;
      
      // If indexer hasn't loaded it yet (common in live monitoring), wait briefly and retry
      await sleep(1000);
    } catch (err) {
      if (err.message && (err.message.includes('429') || err.message.includes('Too many requests') || err.code === 429)) {
        await sleep(delay);
        delay *= 1.5; // Exponential backoff
      } else {
        throw err;
      }
    }
  }
  return null; // Return null if not found after retries
}

/**
 * Parses transaction metadata to identify buy and sell swap events for the target wallet.
 * @param {ParsedTransactionWithMeta} tx - Raw transaction object from RPC
 * @param {string} walletAddressStr - Target wallet address string
 * @returns {Array<Object>|null} Array of parsed swaps or null
 */
export function parseTransactionSwaps(tx, walletAddressStr) {
  if (!tx || !tx.meta) return null;

  const accountKeys = tx.transaction.message.staticAccountKeys.map(k => k.toBase58());
  const walletIndex = accountKeys.indexOf(walletAddressStr);

  if (walletIndex === -1) {
    return null; // Target wallet was not directly involved as a transaction signer/signer account
  }

  // 1. SOL changes (native balance)
  const preSol = tx.meta.preBalances[walletIndex] / 1e9;
  const postSol = tx.meta.postBalances[walletIndex] / 1e9;
  const nativeSolChange = postSol - preSol;

  // 2. Token changes
  const preTokens = tx.meta.preTokenBalances || [];
  const postTokens = tx.meta.postTokenBalances || [];

  // Find all unique mint addresses in transaction balances
  const allMints = new Set([
    ...preTokens.map(t => t.mint),
    ...postTokens.map(t => t.mint)
  ]);

  let wsolChange = 0;
  const tokenChanges = [];

  for (const mint of allMints) {
    // Only check token accounts owned by our target wallet
    const preObj = preTokens.find(t => t.mint === mint && t.owner === walletAddressStr);
    const postObj = postTokens.find(t => t.mint === mint && t.owner === walletAddressStr);

    const preAmount = preObj ? (preObj.uiTokenAmount.uiAmount ?? 0) : 0;
    const postAmount = postObj ? (postObj.uiTokenAmount.uiAmount ?? 0) : 0;
    const change = postAmount - preAmount;

    if (change === 0) continue;

    if (mint === WSOL_MINT) {
      wsolChange = change;
    } else {
      tokenChanges.push({
        mint,
        change,
        preAmount,
        postAmount
      });
    }
  }

  // Combine Native SOL change and Wrapped SOL change to get effective SOL balance change
  const netSolChange = nativeSolChange + wsolChange;
  const blockTime = tx.blockTime;
  const txHash = tx.transaction.signatures[0];

  // If no SPL token balances changed, it's not a token swap trade
  if (tokenChanges.length === 0) return null;

  const swaps = [];

  for (const tc of tokenChanges) {
    // BUY: SOL balance decreased (spent SOL) and Token balance increased
    if (netSolChange < -0.0005 && tc.change > 0) {
      swaps.push({
        type: 'buy',
        tokenMint: tc.mint,
        solAmount: Math.abs(netSolChange),
        tokenAmount: tc.change,
        walletSolBalanceBefore: preSol, // Use preSol (native SOL balance before trade) to estimate target balance
        preTokenAmount: tc.preAmount,
        postTokenAmount: tc.postAmount,
        blockTime,
        txHash
      });
    }
    // SELL: SOL balance increased (received SOL) and Token balance decreased
    else if (netSolChange > 0.0005 && tc.change < 0) {
      swaps.push({
        type: 'sell',
        tokenMint: tc.mint,
        solAmount: netSolChange,
        tokenAmount: Math.abs(tc.change),
        walletSolBalanceBefore: preSol,
        preTokenAmount: tc.preAmount,
        postTokenAmount: tc.postAmount,
        blockTime,
        txHash
      });
    }
  }

  return swaps.length > 0 ? swaps : null;
}
