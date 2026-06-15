import dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';

// Load environment variables
dotenv.config();

const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const targetWalletStr = process.env.TARGET_WALLET || '3BLjRcxWGtR7WRshJ3hL25U3RjWr5Ud98wMcczQqk4Ei';

let targetWallet;
try {
  targetWallet = new PublicKey(targetWalletStr);
} catch (err) {
  console.error(`[ERROR] Invalid TARGET_WALLET address in environment: "${targetWalletStr}". Must be a valid Solana public key.`);
  process.exit(1);
}

const startCapital = parseFloat(process.env.START_CAPITAL || '1.0');
const minCopySize = parseFloat(process.env.MIN_COPY_SIZE || '0.05');
const maxCopySize = parseFloat(process.env.MAX_COPY_SIZE || '0.10');
const minTargetEntrySize = parseFloat(process.env.MIN_TARGET_ENTRY_SIZE || '0.9');

// Estimated fee per transaction in SOL (standard fee + typical priority fee)
const TRANSACTION_FEE_SOL = 0.0005; 

export const config = {
  rpcUrl,
  targetWallet,
  targetWalletStr,
  startCapital,
  minCopySize,
  maxCopySize,
  minTargetEntrySize,
  txFeeSol: TRANSACTION_FEE_SOL
};
