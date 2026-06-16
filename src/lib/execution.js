import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getCopySettings, getExecutionWallets,
  getRealHoldings, getRealTrades,
  addRealTrade, updateRealTrade, saveRealHolding, deleteRealHolding
} from './db.js';
import { decrypt } from './crypto.js';
import { buildPumpDevTransaction, sendViaJito, getTokenBalanceForWallet } from './pumpdev.js';
import { getCachedBlockhash, getCachedBalance, invalidateBalance } from './cache.js';

// Pending sells: target sold before our buy landed.
// Key: `${execWalletAddress}:${mint}`, Value: timestamp
const pendingSells = new Map();
const PENDING_SELL_TTL = 60_000; // forget after 60s

// In-memory event log (last 100 events, newest first)
const eventLog = [];
const MAX_EVENTS = 100;

export function getEventLog() { return eventLog; }

function logEvent(type, data) {
  eventLog.unshift({ type, ts: Date.now(), ...data });
  if (eventLog.length > MAX_EVENTS) eventLog.length = MAX_EVENTS;
}

export async function executeRealCopyTrades(swap, targetWalletAddress) {
  try {
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const settings = await getCopySettings();
    const activeMappings = settings.filter(s => s.targetWallet === targetWalletAddress && s.isActive);
    if (!activeMappings.length) return;

    const executionWallets = await getExecutionWallets();

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

async function executeSell(connection, keypair, execWallet, swap, targetWalletAddress, slippagePct) {
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

  const signedTx = await buildPumpDevTransaction({
    publicKey: execWallet.address, action: 'sell',
    mint: swap.tokenMint, amount: rawAmount,
    denominatedInSol: false, slippagePct, priorityFeeSol: 0.003
  });

  let signature;
  try {
    signature = await sendViaJito(signedTx, keypair, connection);
  } catch (jitoErr) {
    throw new Error(`Jito submit failed: ${jitoErr.message}`);
  }
  const sellMs = Date.now() - t0;
  invalidateBalance(keypair.publicKey.toString());
  console.log(`[COPIER] SELL sent in ${sellMs}ms | sig: ${signature}`);
  logEvent('SELL_SENT', { wallet: execWallet.name, mint: swap.tokenMint, ms: sellMs, sig: signature });

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

async function executeTrade(swap, targetWalletAddress, mapping, execWallet, connection) {
  const keypair = Keypair.fromSecretKey(bs58.decode(decrypt(execWallet.encryptedPrivateKey).trim()));
  const slippagePct = Math.round(mapping.slippageBps / 100);
  const pendingKey = `${execWallet.address}:${swap.tokenMint}`;

  if (swap.type === 'buy') {
    // If we already got a sell for this token before this buy landed, skip entirely
    const pendingSell = pendingSells.get(pendingKey);
    if (pendingSell) {
      pendingSells.delete(pendingKey);
      console.log(`[COPIER] Skipping BUY — target already sold ${swap.tokenMint.slice(0,6)} (scalp detected)`);
      logEvent('SCALP_SKIPPED', { wallet: execWallet.name, mint: swap.tokenMint, scenario: 'A', detail: 'Sell arrived before buy — entry skipped entirely' });
      return;
    }

    const holdings = await getRealHoldings(execWallet.address);
    if (holdings.some(h => h.mint === swap.tokenMint)) {
      console.log(`[COPIER] Already holding ${swap.tokenMint}, skipping.`);
      return;
    }

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

    let signedTx;
    try {
      signedTx = await buildPumpDevTransaction({
        publicKey: execWallet.address, action: 'buy',
        mint: swap.tokenMint, amount: buySizeSol,
        denominatedInSol: true, slippagePct, priorityFeeSol: 0.003
      });
    } catch (pdErr) {
      throw new Error(`PumpDev build failed: ${pdErr.message}`);
    }

    let signature;
    try {
      signature = await sendViaJito(signedTx, keypair, connection);
    } catch (jitoErr) {
      throw new Error(`Jito submit failed: ${jitoErr.message}`);
    }
    const buyMs = Date.now() - t0;
    invalidateBalance(keypair.publicKey.toString());
    console.log(`[COPIER] BUY sent in ${buyMs}ms | sig: ${signature}`);
    logEvent('BUY_SENT', { wallet: execWallet.name, mint: swap.tokenMint, solAmount: buySizeSol, ms: buyMs, sig: signature });

    // Check again: did a sell arrive while we were building/sending the buy?
    if (pendingSells.has(pendingKey)) {
      pendingSells.delete(pendingKey);
      console.log(`[COPIER] Sell arrived during buy execution — selling immediately`);
      logEvent('SCALP_SELL_QUEUED', { wallet: execWallet.name, mint: swap.tokenMint, scenario: 'B', detail: 'Sell arrived while buy was in flight — waiting 3s then selling' });
      await new Promise(r => setTimeout(r, 3000));
      await executeSell(connection, keypair, execWallet, swap, targetWalletAddress, slippagePct);
      return;
    }

    // Normal path: log the buy
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

    if (!holding || holding.amount <= 0) {
      const now = Date.now();
      for (const [k, ts] of pendingSells) {
        if (now - ts > PENDING_SELL_TTL) pendingSells.delete(k);
      }
      pendingSells.set(pendingKey, now);
      console.log(`[COPIER] Sell received before buy landed — parked for ${swap.tokenMint.slice(0,6)}`);
      logEvent('SELL_PARKED', { wallet: execWallet.name, mint: swap.tokenMint, scenario: 'B-pending', detail: 'Sell arrived before buy confirmed — parked, will sell once buy lands' });
      return;
    }

    await executeSell(connection, keypair, execWallet, swap, targetWalletAddress, slippagePct);
  }
}
