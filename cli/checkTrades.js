import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import path from 'path';
import { getTransactionWithRetry, parseTransactionSwaps } from './parser.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

async function main() {
  const args = process.argv.slice(2);
  const walletStr = args[0] || '98T65wcMEjoNLDTJszBHGZEX75QRe8QaANXokv4yw3Mp';
  const limit = parseInt(args[1] || '50', 10);

  console.log(`Checking trades for: ${walletStr}`);
  console.log(`RPC: ${rpcUrl}`);

  const signatures = await connection.getSignaturesForAddress(new PublicKey(walletStr), { limit });
  console.log(`Fetched ${signatures.length} transaction signatures.`);

  let swapCount = 0;
  for (const sigInfo of signatures) {
    if (sigInfo.err) continue;
    try {
      const tx = await getTransactionWithRetry(connection, sigInfo.signature);
      if (tx) {
        const swaps = parseTransactionSwaps(tx, walletStr);
        if (swaps) {
          for (const s of swaps) {
            swapCount++;
            console.log(`[SWAP] Type: ${s.type.toUpperCase()} | Token: ${s.tokenMint.slice(0, 8)}... | Size: ${s.solAmount.toFixed(4)} SOL | Tx: ${sigInfo.signature}`);
          }
        }
      }
    } catch (err) {
      console.log(`Error on sig ${sigInfo.signature}: ${err.message}`);
    }
  }
  console.log(`Finished checking. Total swaps found: ${swapCount}`);
}

main().catch(err => console.error(err));
