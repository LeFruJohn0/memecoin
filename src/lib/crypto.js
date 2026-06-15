import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Derive a 32-byte encryption key from the user's password string using SHA-256
function getEncryptionKey() {
  const password = process.env.ENCRYPTION_KEY;
  if (!password || password.trim() === '') {
    throw new Error('ENCRYPTION_KEY environment variable is not configured.');
  }
  return crypto.createHash('sha256').update(password).digest();
}

/**
 * Encrypts a text string using AES-256-GCM
 * @param {string} text - The raw private key string to encrypt
 * @returns {string} Encrypted payload formatted as iv:authTag:cipherText
 */
export function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard GCM IV size is 12 bytes
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a text string using AES-256-GCM
 * @param {string} encryptedData - The encrypted payload formatted as iv:authTag:cipherText
 * @returns {string} The decrypted raw private key string
 */
export function decrypt(encryptedData) {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format.');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Verifies that a string is a valid Solana private key in base58.
 * Returns the public key (address) if valid, otherwise throws an error.
 * @param {string} privateKeyBase58 - The base58 private key string
 * @returns {string} Derived public address
 */
export function validateAndDeriveAddress(privateKeyBase58) {
  try {
    const decoded = bs58.decode(privateKeyBase58.trim());
    if (decoded.length !== 64) {
      throw new Error('Solana private key must be exactly 64 bytes decoded.');
    }
    const keypair = Keypair.fromSecretKey(decoded);
    return keypair.publicKey.toString();
  } catch (err) {
    throw new Error('Invalid Solana private key. Must be a valid Base58 string.');
  }
}
