// @ts-nocheck
// Exchange rate module — fetches once per session (1 hr TTL), caches in memory.
// Base currency: USD. All rates are "1 USD = X currency".

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _rates = null;       // { USD: 1, EUR: 0.92, HKD: 7.78, ... }
let _fetchedAt = 0;
let _pending = null;

/**
 * Returns exchange rates (USD-based) or null if unavailable.
 * Caches for 1 hour. Never throws.
 */
export async function getExchangeRates() {
  const now = Date.now();
  if (_rates && now - _fetchedAt < CACHE_TTL_MS) return _rates;
  if (_pending) return _pending;

  _pending = fetch("https://open.er-api.com/v6/latest/USD")
    .then(r => r.json())
    .then(data => {
      if (data?.result === "success" && data.rates) {
        _rates = { ...data.rates, USD: 1 };
        _fetchedAt = Date.now();
      }
      _pending = null;
      return _rates;
    })
    .catch(() => {
      _pending = null;
      return _rates; // return stale cache on error
    });

  return _pending;
}

/**
 * Convert `amount` from `fromCurrency` to `toCurrency` using cached rates.
 * Returns null if rates are missing or currencies are unknown.
 */
export function convertAmount(amount, fromCurrency, toCurrency, rates) {
  if (amount === null || amount === undefined || isNaN(amount)) return null;
  if (!rates) return null;
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return amount;
  const fromRate = rates[fromCurrency];
  const toRate   = rates[toCurrency];
  if (!fromRate || !toRate) return null;
  // Both rates are relative to USD: 1 USD = fromRate units of fromCurrency
  // amount fromCurrency → USD: amount / fromRate
  // USD → toCurrency: * toRate
  return (amount / fromRate) * toRate;
}

/** Quick live rate lookup: "1 A = X B". Returns null if unavailable. */
export function getRate(from, to, rates) {
  return convertAmount(1, from, to, rates);
}
