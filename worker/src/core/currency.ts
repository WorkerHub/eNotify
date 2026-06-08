interface ExchangeRateCache {
  rates: Record<string, number>;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in ms
const CACHE_TTL_S = 24 * 60 * 60; // 24 hours in seconds (for KV expiration)

export async function getExchangeRates(
  kv: KVNamespace,
  baseCurrency: string,
): Promise<Record<string, number>> {
  const cacheKey = `exchange_rates:${baseCurrency}`;

  const cached = await kv.get<ExchangeRateCache>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.rates;
  }

  const response = await fetch(
    `https://api.frankfurter.dev/latest?from=${encodeURIComponent(baseCurrency)}`,
  );

  if (!response.ok) {
    // Return stale cached data as fallback rather than surfacing a fetch error
    if (cached) return cached.rates;
    throw new Error(
      `Failed to fetch exchange rates for ${baseCurrency}: HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as { rates: Record<string, number> };
  const rates = data.rates;

  await kv.put(
    cacheKey,
    JSON.stringify({
      rates,
      timestamp: Date.now(),
    } satisfies ExchangeRateCache),
    { expirationTtl: CACHE_TTL_S },
  );

  return rates;
}

/**
 * Convert `amount` from `from` to `to` using the provided rate map.
 * `rates` is the map returned by getExchangeRates(kv, baseCurrency),
 * keyed FROM baseCurrency. So rates[X] = how many X per 1 baseCurrency.
 *
 * To convert `from` → `to`:
 *   If `to` is the base (i.e. rates[to] is undefined but rates[from] exists):
 *     amount / rates[from]
 *   If `from` is the base (i.e. rates[from] is undefined but rates[to] exists):
 *     amount * rates[to]
 *   Otherwise cross-rate via base: amount / rates[from] * rates[to]
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (from === to) return amount;

  const rateFrom = rates[from];
  const rateTo = rates[to];

  if (rateFrom !== undefined && rateTo !== undefined) {
    return (amount / rateFrom) * rateTo;
  }
  if (rateFrom !== undefined) {
    return amount / rateFrom;
  }
  if (rateTo !== undefined) {
    return amount * rateTo;
  }

  return amount;
}
