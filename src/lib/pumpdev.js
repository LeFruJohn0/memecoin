import { Keypair, VersionedTransaction, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

const PUMPDEV_API = 'https://pumpdev.io/api/trade-local';

/**
 * Builds a buy or sell transaction via PumpDev's trade-local endpoint.
 * Used as a fallback when Jupiter returns TOKEN_NOT_TRADABLE (bonding curve tokens).
 * PumpDev auto-routes between pump.fun bonding curve and PumpSwap for graduated tokens.
 *
 * @param {Object} opts
 * @param {string} opts.publicKey - Wallet public key (base58)
 * @param {'buy'|'sell'} opts.action
 * @param {string} opts.mint - Token mint address
 * @param {number|string} opts.amount - SOL amount for buys, "100%" for full sells
 * @param {boolean} opts.denominatedInSol - true for SOL-denominated buys
 * @param {number} opts.slippagePct - Slippage percent (e.g. 10 for 10%)
 * @param {number} opts.priorityFeeSol - Priority fee in SOL (e.g. 0.003)
 * @returns {Promise<string>} Base64-encoded serialized transaction ready to sign
 */
export async function buildPumpDevTransaction({
  publicKey,
  action,
  mint,
  amount,
  denominatedInSol = true,
  slippagePct = 10,
  priorityFeeSol = 0.003
}) {
  const apiKey = process.env.PUMPDEV_API_KEY;
  if (!apiKey) throw new Error('PUMPDEV_API_KEY environment variable is not set');

  const res = await fetch(PUMPDEV_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({
      publicKey,
      action,
      mint,
      amount,
      denominatedInSol: denominatedInSol.toString(),
      slippage: slippagePct,
      priorityFee: priorityFeeSol,
      pool: 'auto'
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PumpDev API failed: ${errText}`);
  }

  // PumpDev returns raw transaction bytes, convert to base64 for signAndSendSwap
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

/**
 * Gets token balance for a wallet after a transaction settles.
 * Used to determine how many tokens were received in a PumpDev buy.
 *
 * @param {Connection} connection
 * @param {string} walletAddress
 * @param {string} mint
 * @param {number} decimals
 * @returns {Promise<number>}
 */
export async function getTokenBalanceForWallet(connection, walletAddress, mint, decimals = 9) {
  const { PublicKey } = await import('@solana/web3.js');
  const tokenAccounts = await connection.getTokenAccountsByOwner(
    new PublicKey(walletAddress),
    { mint: new PublicKey(mint) }
  );
  if (tokenAccounts.value.length === 0) return 0;
  const balanceRes = await connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
  return parseInt(balanceRes.value.amount, 10) / (10 ** decimals);
}
