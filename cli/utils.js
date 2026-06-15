/**
 * Resolves after a specified delay.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Formats a number of SOL into a standard string representation.
 * @param {number} amount - SOL amount
 * @returns {string}
 */
export function formatSol(amount) {
  return `${amount.toFixed(4)} SOL`;
}

/**
 * Formats a percentage change value.
 * @param {number} val - Percentage change (e.g. -15.42 or 30)
 * @returns {string}
 */
export function formatPercent(val) {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

/**
 * Formats unix block time into local date/time string.
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string}
 */
export function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Formats a public key string into a shortened readable address.
 * @param {string} address - Base58 address
 * @returns {string}
 */
export function formatAddress(address) {
  if (!address) return 'N/A';
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}
