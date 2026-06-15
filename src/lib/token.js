const tokenCache = new Map();

// Seed some standard tokens to avoid network requests
tokenCache.set('So11111111111111111111111111111111111111112', { name: 'Wrapped SOL', symbol: 'SOL' });

/**
 * Fetches token metadata (symbol and name) from Jupiter's public API.
 * @param {string} mint - SPL Token mint address
 * @returns {Promise<{name: string, symbol: string}>}
 */
export async function getTokenMetadata(mint) {
  if (!mint) return { name: 'Unknown', symbol: 'UNK' };

  if (tokenCache.has(mint)) {
    return tokenCache.get(mint);
  }

  try {
    const res = await fetch(`https://tokens.jup.ag/token/${mint}`, {
      headers: {
        'Accept': 'application/json'
      },
      next: { revalidate: 86400 } // Cache for 24h in Next.js
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.symbol) {
        const meta = {
          name: data.name || 'Unknown Token',
          symbol: data.symbol || 'UNK'
        };
        tokenCache.set(mint, meta);
        return meta;
      }
    }
  } catch (err) {
    console.warn(`[TOKEN META] Failed to fetch metadata for ${mint}:`, err.message);
  }

  // Fallback for newly created coins or failed requests
  const fallback = {
    name: 'Meme Coin',
    symbol: mint.slice(0, 6).toUpperCase()
  };
  // Don't cache fallback permanently to retry later, or cache briefly
  tokenCache.set(mint, fallback);
  return fallback;
}
