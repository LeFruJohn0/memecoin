import { Connection, PublicKey } from '@solana/web3.js';
import { 
  getCopySettings, 
  getExecutionWallets, 
  getRealHoldings, 
  getRealTrades, 
  addRealTrade, 
  updateRealTrade, 
  saveRealHolding, 
  deleteRealHolding 
} from './db.js';
import { decrypt } from './crypto.js';
import { getJupiterQuote, buildJupiterSwapTransaction, signAndSendSwap } from './jupiter.js';
import { buildPumpDevTransaction, getTokenBalanceForWallet } from './pumpdev.js';

const WSOL = 'So11111111111111111111111111111111111111112';

function isPumpDevFallbackError(err) {
  const msg = err.message || '';
  return msg.includes('TOKEN_NOT_TRADABLE') || msg.includes('not tradable') || msg.includes('No routes found');
}

/**
 * Executes dynamic copy-trades on-chain for all execution wallets configured to follow the target wallet.
 * @param {Object} swap - The parsed trade transaction details
 * @param {string} targetWalletAddress - Base58 address of the tracked target wallet
 */
export async function executeRealCopyTrades(swap, targetWalletAddress) {
  try {
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // 1. Fetch copy setting configurations
    const settings = await getCopySettings();
    const activeMappings = settings.filter(
      s => s.targetWallet === targetWalletAddress && s.isActive
    );

    if (activeMappings.length === 0) {
      return; // No execution wallets following this target wallet
    }

    // 2. Fetch imported execution wallets to map private keys
    const executionWallets = await getExecutionWallets();

    for (const mapping of activeMappings) {
      const execWallet = executionWallets.find(w => w.address === mapping.executionWallet);
      if (!execWallet) continue;

      console.log(`\n[ON-CHAIN COPIER] Copying trade for target wallet "${targetWalletAddress}" -> execution wallet "${execWallet.name}" (${execWallet.address})`);

      try {
        const decryptedKey = decrypt(execWallet.encryptedPrivateKey);

        if (swap.type === 'buy') {
          // Prevent double-buys of the same token in active holdings
          const holdings = await getRealHoldings(execWallet.address);
          if (holdings.some(h => h.mint === swap.tokenMint)) {
            console.log(`[ON-CHAIN COPIER] Already holding ${swap.tokenMint} in execution wallet "${execWallet.name}". Skipping buy duplication.`);
            continue;
          }

          const buySizeSol = mapping.copySize;
          const inAmountLamports = Math.floor(buySizeSol * 1e9);
          const slippagePct = Math.round(mapping.slippageBps / 100);

          // Pre-check: ensure execution wallet has enough SOL (copySize + ~0.005 for fees)
          const walletBalance = await connection.getBalance(new PublicKey(execWallet.address));
          const walletBalanceSol = walletBalance / 1e9;
          if (walletBalanceSol < buySizeSol + 0.005) {
            console.warn(`[ON-CHAIN COPIER] Skipping BUY — insufficient SOL in "${execWallet.name}": ${walletBalanceSol.toFixed(4)} SOL (need ${(buySizeSol + 0.005).toFixed(4)} SOL)`);
            continue;
          }

          // D: Resolve token decimals (needed for both paths)
          let decimals = 9;
          try {
            const mintInfo = await connection.getParsedAccountInfo(new PublicKey(swap.tokenMint));
            decimals = mintInfo.value?.data?.parsed?.info?.decimals || 9;
          } catch (err) {
            console.warn(`[ON-CHAIN COPIER] Could not parse mint account decimals, defaulting to 9`, err.message);
          }

          let signature, amountBought;

          try {
            // A: Try Jupiter first (works for graduated/DEX-listed tokens)
            console.log(`[ON-CHAIN COPIER] Fetching Jupiter swap quote for ${buySizeSol} SOL -> ${swap.tokenMint} (slippage: ${mapping.slippageBps} bps)...`);
            const quote = await getJupiterQuote(WSOL, swap.tokenMint, inAmountLamports, mapping.slippageBps);

            console.log(`[ON-CHAIN COPIER] Constructing Jupiter transaction payload...`);
            const swapTx = await buildJupiterSwapTransaction(quote, execWallet.address);

            console.log(`[ON-CHAIN COPIER] Signing and broadcasting to Solana...`);
            signature = await signAndSendSwap(swapTx, decryptedKey, connection);
            amountBought = parseInt(quote.outAmount, 10) / (10 ** decimals);
          } catch (jupErr) {
            if (!isPumpDevFallbackError(jupErr)) throw jupErr;

            // B: Fallback to PumpDev for bonding curve tokens (pump.fun not yet graduated)
            console.log(`[ON-CHAIN COPIER] Jupiter failed (${jupErr.message.split('\n')[0]}). Falling back to PumpDev for bonding curve token...`);
            const swapTx = await buildPumpDevTransaction({
              publicKey: execWallet.address,
              action: 'buy',
              mint: swap.tokenMint,
              amount: buySizeSol,
              denominatedInSol: true,
              slippagePct,
              priorityFeeSol: 0.003
            });

            console.log(`[ON-CHAIN COPIER] [PumpDev] Signing and broadcasting to Solana...`);
            signature = await signAndSendSwap(swapTx, decryptedKey, connection);
            // Fetch actual received balance from on-chain since PumpDev doesn't return outAmount
            amountBought = await getTokenBalanceForWallet(connection, execWallet.address, swap.tokenMint, decimals);
          }

          console.log(`[ON-CHAIN COPIER] BUY Transaction landed! Sig: ${signature}`);

          // E: Log trade and update holdings
          const tradeId = await addRealTrade({
            targetWallet: targetWalletAddress,
            executionWallet: execWallet.address,
            tokenMint: swap.tokenMint,
            buyTime: Date.now(),
            solInvested: buySizeSol,
            buyHash: signature
          });

          await saveRealHolding(
            execWallet.address,
            swap.tokenMint,
            amountBought,
            buySizeSol,
            buySizeSol / amountBought,
            Date.now()
          );

          console.log(`[ON-CHAIN COPIER] Completed copy buy logging. Saved database trade ID: ${tradeId}.`);
        } 
        
        else if (swap.type === 'sell') {
          // Check if we hold the token
          const holdings = await getRealHoldings(execWallet.address);
          const holding = holdings.find(h => h.mint === swap.tokenMint);

          if (!holding || holding.amount <= 0) {
            console.log(`[ON-CHAIN COPIER] We do not hold ${swap.tokenMint} in execution wallet "${execWallet.name}". Skipping exit.`);
            continue;
          }

          // Fetch exact on-chain token balance to execute a clean 100% exit
          console.log(`[ON-CHAIN COPIER] Fetching exact on-chain token balance for output ${swap.tokenMint}...`);
          const tokenAccounts = await connection.getTokenAccountsByOwner(
            new PublicKey(execWallet.address),
            { mint: new PublicKey(swap.tokenMint) }
          );

          if (tokenAccounts.value.length === 0) {
            console.log(`[ON-CHAIN COPIER] No active token accounts found on-chain for ${swap.tokenMint}. Skipping.`);
            continue;
          }

          const tokenAccountPubkey = tokenAccounts.value[0].pubkey;
          const balanceRes = await connection.getTokenAccountBalance(tokenAccountPubkey);
          const rawAmountString = balanceRes.value.amount;

          if (parseInt(rawAmountString, 10) <= 0) {
            console.log(`[ON-CHAIN COPIER] On-chain token balance is 0. Skipping.`);
            continue;
          }

          const slippagePct = Math.round(mapping.slippageBps / 100);
          let signature, solReceived;

          try {
            // A: Try Jupiter first
            console.log(`[ON-CHAIN COPIER] Fetching Jupiter swap quote for token -> SOL...`);
            const quote = await getJupiterQuote(swap.tokenMint, WSOL, rawAmountString, mapping.slippageBps);

            console.log(`[ON-CHAIN COPIER] Constructing Jupiter transaction payload...`);
            const swapTx = await buildJupiterSwapTransaction(quote, execWallet.address);

            console.log(`[ON-CHAIN COPIER] Signing and broadcasting to Solana...`);
            signature = await signAndSendSwap(swapTx, decryptedKey, connection);
            solReceived = parseInt(quote.outAmount, 10) / 1e9;
          } catch (jupErr) {
            if (!isPumpDevFallbackError(jupErr)) throw jupErr;

            // B: Fallback to PumpDev for bonding curve tokens
            console.log(`[ON-CHAIN COPIER] Jupiter failed (${jupErr.message.split('\n')[0]}). Falling back to PumpDev...`);
            const solBefore = await connection.getBalance(new PublicKey(execWallet.address));

            const swapTx = await buildPumpDevTransaction({
              publicKey: execWallet.address,
              action: 'sell',
              mint: swap.tokenMint,
              amount: '100%',
              denominatedInSol: false,
              slippagePct,
              priorityFeeSol: 0.003
            });

            console.log(`[ON-CHAIN COPIER] [PumpDev] Signing and broadcasting to Solana...`);
            signature = await signAndSendSwap(swapTx, decryptedKey, connection);
            // Estimate SOL received from wallet balance change (net of tx fees)
            const solAfter = await connection.getBalance(new PublicKey(execWallet.address));
            solReceived = Math.max(0, (solAfter - solBefore) / 1e9);
          }

          console.log(`[ON-CHAIN COPIER] SELL Transaction landed! Sig: ${signature}`);

          // D: Find open trade and close it
          const activeTrades = await getRealTrades(execWallet.address);
          const openTrade = activeTrades.find(t => t.tokenMint === swap.tokenMint && t.status === 'OPEN');

          if (openTrade) {
            const txFee = 0.0035; // standard priority fee + network fee
            const netPnL = solReceived - openTrade.solInvested - txFee;
            const pnlPercent = ((solReceived - openTrade.solInvested) / openTrade.solInvested) * 100;

            await updateRealTrade(openTrade.id, {
              sellTime: Date.now(),
              solReceived,
              netPnL,
              pnlPercent,
              sellHash: signature,
              status: 'COMPLETED'
            });
          }

          // E: Wipe holding
          await deleteRealHolding(execWallet.address, swap.tokenMint);
          console.log(`[ON-CHAIN COPIER] Completed copy sell logging.`);
        }
      } catch (err) {
        console.error(`[ON-CHAIN COPIER ERROR] Transaction failed for execution wallet "${execWallet.name}":`, err.message);
      }
    }
  } catch (err) {
    console.error(`[ON-CHAIN COPIER ERROR] Failed to resolve execution mappings:`, err.message);
  }
}
