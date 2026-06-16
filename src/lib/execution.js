import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getCopySettings, getExecutionWallets,
  getRealHoldings, getRealTrades,
  addRealTrade, updateRealTrade, saveRealHolding, deleteRealHolding
} from './db.js';
import { decrypt } from './crypto.js';
import { buildBuyTx, buildSellTx } from './pumpfun.js';
import { buildPumpDevTransaction, sendViaJito, getTokenBalanceForWallet } from './pumpdev.js';
import { getCachedBlockhash, getCachedBalance, invalidateBalance } from './cache.js';

export async function executeRealCopyTrades(swap, targetWalletAddress) {
  try {
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const settings = await getCopySettings();
    const activeMappings = settings.filter(s => s.targetWallet === targetWalletAddress && s.isActive);
    if (!activeMappings.length) return;

    const executionWallets = await getExecutionWallets();

    // Fire all wallets concurrently — don't wait for one before starting the next
    await Promise.allSettled(activeMappings.map(mapping => {
      const execWallet = executionWallets.find(w => w.address === mapping.executionWallet);
      if (!execWallet) return Promise.resolve();
      return executeTrade(swap, targetWalletAddress, mapping, execWallet, connection)
        .catch(err => console.error(`[COPIER ERROR] ${execWallet.name}: ${err.message}`));
    }));
  } catch (err) {
    console.error(`[COPIER ERROR] ${err.message}`);
  }
}

async function executeTrade(swap, targetWalletAddress, mapping, execWallet, connection) {
  const keypair = Keypair.fromSecretKey(bs58.decode(decrypt(execWallet.encryptedPrivateKey).trim()));
  const slippagePct = Math.round(mapping.slippageBps / 100);

  if (swap.type === 'buy') {
    const holdings = await getRealHoldings(execWallet.address);
    if (holdings.some(h => h.mint === swap.tokenMint)) {
      console.log(`[COPIER] Already holding ${swap.tokenMint}, skipping.`);
      return;
    }

    // Cached balance — no extra RPC round trip
    const walletLamports = await getCachedBalance(keypair.publicKey);
    const walletBalanceSol = walletLamports / 1e9;

    const minSize = mapping.minCopySize ?? mapping.copySize;
    const maxSize = mapping.maxCopySize ?? mapping.copySize;
    const riskRatio = swap.solAmount / (swap.walletSolBalanceBefore || walletBalanceSol || 1.0);
    const buySizeSol = Math.max(minSize, Math.min(maxSize, riskRatio * walletBalanceSol));

    if (walletBalanceSol < buySizeSol + 0.01) {
      console.warn(`[COPIER] Insufficient SOL: ${walletBalanceSol.toFixed(4)}`);
      return;
    }

    console.log(`[COPIER] BUY ${buySizeSol.toFixed(4)} SOL -> ${swap.tokenMint}`);
    const t0 = Date.now();

    // Cached blockhash — no extra RPC round trip
    const blockhash = await getCachedBlockhash();

    let signedTx;
    try {
      // Fast path: build directly against pump.fun program (~100ms, just one RPC for bonding curve)
      signedTx = await buildBuyTx(connection, keypair, swap.tokenMint, buySizeSol, slippagePct, blockhash);
    } catch (err) {
      if (!err.message.includes('GRADUATED')) throw err;
      // Graduated token: fall back to PumpDev HTTP API
      console.log(`[COPIER] Token graduated, using PumpDev fallback...`);
      try {
        signedTx = await buildPumpDevTransaction({
          publicKey: execWallet.address, action: 'buy',
          mint: swap.tokenMint, amount: buySizeSol,
          denominatedInSol: true, slippagePct, priorityFeeSol: 0.003
        });
      } catch (pdErr) {
        throw new Error(`PumpDev build failed: ${pdErr.message}`);
      }
    }

    // Submit via Jito — returns immediately, no confirmation wait
    let signature;
    try {
      signature = await sendViaJito(signedTx, keypair, connection);
    } catch (jitoErr) {
      throw new Error(`Jito submit failed: ${jitoErr.message}`);
    }
    invalidateBalance(keypair.publicKey.toString());
    console.log(`[COPIER] BUY sent in ${Date.now() - t0}ms | sig: ${signature}`);

    // DB logging + balance fetch run in background, trade is already flying
    let decimals = 9;
    try {
      const info = await connection.getParsedAccountInfo(new PublicKey(swap.tokenMint));
      decimals = info.value?.data?.parsed?.info?.decimals ?? 9;
    } catch { /* default */ }

    const [tradeId, amountBought] = await Promise.all([
      addRealTrade({
        targetWallet: targetWalletAddress,
        executionWallet: execWallet.address,
        tokenMint: swap.tokenMint,
        buyTime: Date.now(),
        solInvested: buySizeSol,
        buyHash: signature
      }),
      getTokenBalanceForWallet(connection, execWallet.address, swap.tokenMint, decimals)
    ]);

    await saveRealHolding(
      execWallet.address, swap.tokenMint, amountBought, buySizeSol,
      amountBought > 0 ? buySizeSol / amountBought : 0, Date.now()
    );
    console.log(`[COPIER] BUY logged. id=${tradeId} tokens=${amountBought}`);

  } else if (swap.type === 'sell') {
    const holdings = await getRealHoldings(execWallet.address);
    const holding = holdings.find(h => h.mint === swap.tokenMint);
    if (!holding || holding.amount <= 0) return;

    const tokenAccounts = await connection.getTokenAccountsByOwner(
      keypair.publicKey, { mint: new PublicKey(swap.tokenMint) }
    );
    if (!tokenAccounts.value.length) return;
    const balRes = await connection.getTokenAccountBalance(tokenAccounts.value[0].pubkey);
    const rawAmount = parseInt(balRes.value.amount, 10);
    if (rawAmount <= 0) return;

    console.log(`[COPIER] SELL 100% of ${swap.tokenMint}`);
    const t0 = Date.now();

    const solBefore = await getCachedBalance(keypair.publicKey);
    const blockhash = await getCachedBlockhash();

    let signedTx;
    try {
      signedTx = await buildSellTx(connection, keypair, swap.tokenMint, rawAmount, slippagePct, blockhash);
    } catch (err) {
      if (!err.message.includes('GRADUATED')) throw err;
      console.log(`[COPIER] Token graduated, using PumpDev fallback...`);
      try {
        signedTx = await buildPumpDevTransaction({
          publicKey: execWallet.address, action: 'sell',
          mint: swap.tokenMint, amount: '100%',
          denominatedInSol: false, slippagePct, priorityFeeSol: 0.003
        });
      } catch (pdErr) {
        throw new Error(`PumpDev build failed: ${pdErr.message}`);
      }
    }

    let signature;
    try {
      signature = await sendViaJito(signedTx, keypair, connection);
    } catch (jitoErr) {
      throw new Error(`Jito submit failed: ${jitoErr.message}`);
    }
    invalidateBalance(keypair.publicKey.toString());
    console.log(`[COPIER] SELL sent in ${Date.now() - t0}ms | sig: ${signature}`);

    // Estimate PnL from balance delta after brief settle
    await new Promise(r => setTimeout(r, 2000));
    const solAfter = await connection.getBalance(keypair.publicKey);
    const solReceived = Math.max(0, (solAfter - solBefore) / 1e9);

    const activeTrades = await getRealTrades(execWallet.address);
    const openTrade = activeTrades.find(t => t.tokenMint === swap.tokenMint && t.status === 'OPEN');
    if (openTrade) {
      const netPnL = solReceived - openTrade.solInvested - 0.004;
      await updateRealTrade(openTrade.id, {
        sellTime: Date.now(), solReceived, netPnL,
        pnlPercent: (netPnL / openTrade.solInvested) * 100,
        sellHash: signature, status: 'COMPLETED'
      });
    }
    await deleteRealHolding(execWallet.address, swap.tokenMint);
    console.log(`[COPIER] SELL logged.`);
  }
}
