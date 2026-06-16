/**
 * Direct pump.fun bonding curve transaction builder.
 * No HTTP calls — fetches bonding curve state from RPC and builds the instruction locally.
 * Falls back by throwing 'GRADUATED' if the token has already migrated to PumpSwap.
 */
import {
  PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';

const PUMP_PROGRAM    = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL     = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5zP9QkMsRFSF5h5');
const PUMP_FEE        = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const PUMP_EVENT_AUTH = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const TOKEN_PROGRAM   = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_PROGRAM   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bsc');

const BUY_IX  = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_IX = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

// Derive bonding curve PDA and its token account
export function derivePDAs(mint) {
  const mintKey = new PublicKey(mint);
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintKey.toBytes()],
    PUMP_PROGRAM
  );
  const [assocBondingCurve] = PublicKey.findProgramAddressSync(
    [bondingCurve.toBytes(), TOKEN_PROGRAM.toBytes(), mintKey.toBytes()],
    ASSOC_PROGRAM
  );
  return { mintKey, bondingCurve, assocBondingCurve };
}

// Derive user's associated token account address (no spl-token needed)
export function deriveATA(wallet, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()],
    ASSOC_PROGRAM
  );
  return ata;
}

// Bonding curve account layout (after 8-byte Anchor discriminator):
// 8:  u64 virtual_token_reserves
// 16: u64 virtual_sol_reserves
// 24: u64 real_token_reserves
// 32: u64 real_sol_reserves
// 40: u64 token_total_supply
// 48: bool complete
async function fetchCurve(connection, bondingCurve) {
  const info = await connection.getAccountInfo(bondingCurve);
  if (!info) throw new Error('GRADUATED'); // no bonding curve = migrated
  const d = info.data;
  const complete = d[48] === 1;
  if (complete) throw new Error('GRADUATED');
  return {
    vTokenReserves: d.readBigUInt64LE(8),
    vSolReserves:   d.readBigUInt64LE(16),
  };
}

export async function buildBuyTx(connection, keypair, mint, solAmount, slippagePct, blockhash) {
  const { mintKey, bondingCurve, assocBondingCurve } = derivePDAs(mint);
  const { vTokenReserves, vSolReserves } = await fetchCurve(connection, bondingCurve);

  const solLamports  = BigInt(Math.floor(solAmount * 1e9));
  const feeLamports  = solLamports / 100n;             // 1% pump.fun fee
  const netSol       = solLamports - feeLamports;
  const tokensOut    = (vTokenReserves * netSol) / (vSolReserves + netSol);
  const minTokens    = tokensOut * BigInt(100 - slippagePct) / 100n;
  const maxSolCost   = solLamports + (solLamports * BigInt(slippagePct) / 100n);

  const ixData = Buffer.alloc(24);
  BUY_IX.copy(ixData, 0);
  ixData.writeBigUInt64LE(minTokens, 8);
  ixData.writeBigUInt64LE(maxSolCost, 16);

  const ata = deriveATA(keypair.publicKey, mintKey);

  // Use idempotent create-ATA (discriminator = 1) so we skip the existence RPC check
  const createAtaIx = new TransactionInstruction({
    programId: ASSOC_PROGRAM,
    keys: [
      { pubkey: keypair.publicKey, isSigner: true,  isWritable: true  },
      { pubkey: ata,               isSigner: false, isWritable: true  },
      { pubkey: keypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: mintKey,           isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM,     isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]) // idempotent variant
  });

  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: PUMP_GLOBAL,        isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE,           isSigner: false, isWritable: true  },
      { pubkey: mintKey,            isSigner: false, isWritable: false },
      { pubkey: bondingCurve,       isSigner: false, isWritable: true  },
      { pubkey: assocBondingCurve,  isSigner: false, isWritable: true  },
      { pubkey: ata,                isSigner: false, isWritable: true  },
      { pubkey: keypair.publicKey,  isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM,      isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTH,    isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM,       isSigner: false, isWritable: false },
    ],
    data: ixData
  });

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.add(createAtaIx, buyIx);
  tx.sign(keypair);
  return tx;
}

export async function buildSellTx(connection, keypair, mint, rawTokenAmount, slippagePct, blockhash) {
  const { mintKey, bondingCurve, assocBondingCurve } = derivePDAs(mint);
  const { vTokenReserves, vSolReserves } = await fetchCurve(connection, bondingCurve);

  const tokens     = BigInt(rawTokenAmount);
  const grossSol   = (vSolReserves * tokens) / (vTokenReserves + tokens);
  const feeSol     = grossSol / 100n;
  const netSol     = grossSol - feeSol;
  const minSolOut  = netSol * BigInt(100 - slippagePct) / 100n;

  const ixData = Buffer.alloc(24);
  SELL_IX.copy(ixData, 0);
  ixData.writeBigUInt64LE(tokens, 8);
  ixData.writeBigUInt64LE(minSolOut, 16);

  const ata = deriveATA(keypair.publicKey, mintKey);

  const sellIx = new TransactionInstruction({
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: PUMP_GLOBAL,        isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE,           isSigner: false, isWritable: true  },
      { pubkey: mintKey,            isSigner: false, isWritable: false },
      { pubkey: bondingCurve,       isSigner: false, isWritable: true  },
      { pubkey: assocBondingCurve,  isSigner: false, isWritable: true  },
      { pubkey: ata,                isSigner: false, isWritable: true  },
      { pubkey: keypair.publicKey,  isSigner: true,  isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOC_PROGRAM,      isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM,      isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTH,    isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM,       isSigner: false, isWritable: false },
    ],
    data: ixData
  });

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.add(sellIx);
  tx.sign(keypair);
  return tx;
}
