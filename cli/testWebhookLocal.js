import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

async function sendMockWebhook() {
  const args = process.argv.slice(2);
  const walletAddressStr = args[0];
  const signatureCount = parseInt(args[1] || '5', 10);

  if (!walletAddressStr) {
    console.error('Error: Please provide a Solana wallet address.');
    console.log('Usage: node cli/testWebhookLocal.js <WALLET_ADDRESS> [signature_count]');
    process.exit(1);
  }

  let walletKey;
  try {
    walletKey = new PublicKey(walletAddressStr);
  } catch (err) {
    console.error('Error: Invalid Solana wallet public key.');
    process.exit(1);
  }

  console.log(`\n=====================================================`);
  console.log(`      SOLANA WEBHOOK SIMULATED TRIGGER UTILITY      `);
  console.log(`=====================================================`);
  console.log(`Target Wallet: ${walletAddressStr}`);
  console.log(`Fetching last ${signatureCount} transactions from Solana ledger...`);

  let sigs;
  try {
    sigs = await connection.getSignaturesForAddress(walletKey, { limit: signatureCount });
  } catch (err) {
    console.error(`Failed to fetch transactions from Solana:`, err.message);
    process.exit(1);
  }

  if (sigs.length === 0) {
    console.log('No transactions found on-chain for this wallet address.');
    return;
  }

  console.log(`Found ${sigs.length} signatures. Sending mock webhooks to dev server...`);

  // Build the mock webhook payloads
  const payloads = sigs.map(s => {
    return {
      signature: s.signature,
      feePayer: walletAddressStr,
      accountData: [
        { account: walletAddressStr }
      ]
    };
  });

  // POST each payload as a single transaction webhook to /api/webhook
  for (let i = 0; i < payloads.length; i++) {
    const payload = [payloads[i]]; // webhook receives array of transactions
    console.log(`\n[${i+1}/${payloads.length}] POSTing signature: ${payloads[0].signature}`);

    try {
      const response = await fetch('http://localhost:3000/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      console.log(`Response status: ${response.status} | Success: ${data.success}`);
      if (data.message) console.log(`Details: ${data.message}`);
      if (data.error) console.error(`Error details:`, data.error);
    } catch (err) {
      console.error(`Fetch request failed. Make sure Next.js is running on http://localhost:3000! Error:`, err.message);
    }
  }

  console.log(`\nFinished sending simulated webhook triggers.`);
}

sendMockWebhook().catch(err => {
  console.error('Unhandled error:', err);
});
