import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Gets a swap quote from Jupiter.
 * @param {string} inputMint - Token mint swapping from (e.g. So11111111111111111111111111111111111111112 for SOL)
 * @param {string} outputMint - Token mint swapping to
 * @param {number|string} amountLamports - Amount to swap in lamports (or smallest token units)
 * @param {number} slippageBps - Slippage tolerance in basis points (100 bps = 1%)
 * @returns {Promise<Object>} The quote response object from Jupiter
 */
export async function getJupiterQuote(inputMint, outputMint, amountLamports, slippageBps = 1000) {
  // Default slippage is set to 1000 bps (10%) to ensure fast-moving memecoin trades execute instantly
  const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
  
  const headers = {};
  if (process.env.JUPITER_API_KEY) {
    headers['X-Api-Key'] = process.env.JUPITER_API_KEY;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Jupiter Quote API failed: ${errText}`);
  }
  return res.json();
}

/**
 * Builds the swap transaction payload from Jupiter.
 * @param {Object} quoteResponse - The quote object from getJupiterQuote
 * @param {string} userPublicKey - Base58 address of the executing wallet
 * @param {number} prioritizationFeeLamports - Priority fee in lamports (e.g. 3,000,000 = 0.003 SOL)
 * @returns {Promise<string>} Base64-encoded transaction string
 */
export async function buildJupiterSwapTransaction(quoteResponse, userPublicKey, prioritizationFeeLamports = 3000000) {
  const url = 'https://api.jup.ag/swap/v1/swap';
  
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.JUPITER_API_KEY) {
    headers['X-Api-Key'] = process.env.JUPITER_API_KEY;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports
    })
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Jupiter Swap API failed: ${errText}`);
  }
  
  const { swapTransaction } = await res.json();
  return swapTransaction;
}

/**
 * Deserializes, signs, and executes the swap transaction on-chain.
 * @param {string} swapTxBase64 - The transaction payload from buildJupiterSwapTransaction
 * @param {string} privateKeyBase58 - The decrypted base58 private key of the execution wallet
 * @param {Connection} connection - Web3 connection to the RPC node
 * @returns {Promise<string>} The transaction signature hash
 */
export async function signAndSendSwap(swapTxBase64, privateKeyBase58, connection) {
  const decodedKey = bs58.decode(privateKeyBase58.trim());
  const keypair = Keypair.fromSecretKey(decodedKey);
  
  // Deserialize the transaction
  const txBuf = Buffer.from(swapTxBase64, 'base64');
  const transaction = VersionedTransaction.deserialize(txBuf);
  
  // Sign the transaction
  transaction.sign([keypair]);
  
  // Send the raw transaction to Solana
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true, // Speed optimization: skip preflight simulation in copy trading
    preflightCommitment: 'confirmed'
  });
  
  // Confirm the transaction
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, 'confirmed');
  
  return signature;
}
