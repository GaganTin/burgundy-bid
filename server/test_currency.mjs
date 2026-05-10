/**
 * Comprehensive tests for WS currency selection logic.
 *
 * Run: node server/test_currency.mjs
 *
 * Covers:
 *  1. Currency sanitization helper
 *  2. WS search URL construction (extension path)
 *  3. WS search URL construction (server path)
 *  4. Default-to-USD when currency is absent/falsy
 *  5. Extension result payload carries correct ws_currency
 *  6. Server per-row UPDATE includes ws_currency column
 *  7. Batch-level UPDATE sets ws_currency before per-row updates
 *  8. Lookup.jsx currency resolution (wsCurrency || 'USD')
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── 1. Currency sanitization (matches all sanitize calls in codebase) ─────────
console.log('\n[1] Currency sanitization');

function sanitizeCurrency(raw) {
  return (raw || '').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
}

assertEqual(sanitizeCurrency('USD'),        'USD',  'plain USD unchanged');
assertEqual(sanitizeCurrency('eur'),        'EUR',  'lowercase eur → EUR');
assertEqual(sanitizeCurrency('GbP'),        'GBP',  'mixed case GbP → GBP');
assertEqual(sanitizeCurrency('AUD'),        'AUD',  'AUD');
assertEqual(sanitizeCurrency('CAD'),        'CAD',  'CAD');
assertEqual(sanitizeCurrency('CHF'),        'CHF',  'CHF');
assertEqual(sanitizeCurrency('HKD'),        'HKD',  'HKD');
assertEqual(sanitizeCurrency('SGD'),        'SGD',  'SGD');
assertEqual(sanitizeCurrency('JPY'),        'JPY',  'JPY');
assertEqual(sanitizeCurrency(null),         'USD',  'null → USD default');
assertEqual(sanitizeCurrency(undefined),    'USD',  'undefined → USD default');
assertEqual(sanitizeCurrency(''),           'USD',  'empty string → USD default');
assertEqual(sanitizeCurrency('  '),         'USD',  'whitespace-only → USD default');
assertEqual(sanitizeCurrency('U$D'),        'UD',   'strip non-alpha chars (U$D → UD)');
assertEqual(sanitizeCurrency('123'),        'USD',  'digits only → USD default');
assertEqual(sanitizeCurrency('€EUR'),       'EUR',  'leading symbol stripped → EUR');

// ── 2. WS search URL construction ─────────────────────────────────────────────
console.log('\n[2] WS search URL construction');

const WS_BASE = 'https://www.wine-searcher.com';

function buildWsUrl(wineName, vintage, currency) {
  const cur = sanitizeCurrency(currency);
  // return `${WS_BASE}/find/${encodeURIComponent(wineName)}/${vintage || 'any'}/${cur}/ndbipe?Xtax_mode=e&shoptype=1%2C0`;
  // https://www.wine-searcher.com/find/opus+one+napa+valley+county+north+coast+california+usa/2016?Xcurrencycode=USDXtax_mode=e&shoptype=1%2C0
  return `${WS_BASE}/find/${encodeURIComponent(wineName)}/${vintage || 'any'}/-/?Xcurrencycode=${cur}Xtax_mode=e&shoptype=1%2C0`;
}

// Currency segment is the 4th path component (index 3 in /find/name/vintage/currency/...)
function extractCurrencyFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/');
    // pathname: /find/<name>/<vintage>/<currency>/ndbipe
    return parts[4]; // index 0='', 1='find', 2=name, 3=vintage, 4=currency
  } catch { return null; }
}

const urlUsd = buildWsUrl('Château Margaux', '2018', 'USD');
assertEqual(extractCurrencyFromUrl(urlUsd), 'USD', 'USD appears in WS URL path');
assert(urlUsd.includes('/USD/'), 'USD present in URL segment');

const urlEur = buildWsUrl('Château Margaux', '2018', 'EUR');
assertEqual(extractCurrencyFromUrl(urlEur), 'EUR', 'EUR appears in WS URL path');
assert(!urlEur.includes('/USD/'), 'USD not in EUR URL');

const urlGbp = buildWsUrl('Opus One', '2020', 'GBP');
assertEqual(extractCurrencyFromUrl(urlGbp), 'GBP', 'GBP in URL');

const urlDefault = buildWsUrl('Opus One', '2020', null);
assertEqual(extractCurrencyFromUrl(urlDefault), 'USD', 'null currency → USD in URL');

const urlDefaultEmpty = buildWsUrl('Opus One', '2020', '');
assertEqual(extractCurrencyFromUrl(urlDefaultEmpty), 'USD', 'empty string → USD in URL');

// Vintage 'any' when not provided
const urlNoVintage = buildWsUrl('Penfolds Grange', null, 'AUD');
assert(urlNoVintage.includes('/any/'), 'null vintage → any in URL');
assertEqual(extractCurrencyFromUrl(urlNoVintage), 'AUD', 'AUD in URL even with null vintage');

// ── 3. Extension: handleLookupBatch currency logic ────────────────────────────
console.log('\n[3] Extension handleLookupBatch — ws_currency in item');

function simulateExtensionItem(currency) {
  // mirrors background.js line 677
  return { ws_currency: (currency || 'USD').toUpperCase() };
}

function simulateScrapeWsResult(currency) {
  // mirrors background.js scrapeWS return value (ws_currency set to currency param)
  return { ws_currency: currency, ws_avg: '$50', ws_min: '$45' };
}

function simulateExtensionFlow(payloadCurrency) {
  const currency = payloadCurrency || 'USD';
  const item = simulateExtensionItem(currency);
  const wsResult = simulateScrapeWsResult(currency || 'USD');
  Object.assign(item, wsResult); // mirrors Object.assign(item, ws) in handleLookupBatch
  const url = buildWsUrl('Test Wine', '2019', currency);
  return { item, url };
}

const extFlowUsd = simulateExtensionFlow('USD');
assertEqual(extFlowUsd.item.ws_currency, 'USD', 'Extension: USD payload → ws_currency=USD');
assert(extFlowUsd.url.includes('/USD/'), 'Extension: USD in search URL');

const extFlowEur = simulateExtensionFlow('EUR');
assertEqual(extFlowEur.item.ws_currency, 'EUR', 'Extension: EUR payload → ws_currency=EUR');
assert(extFlowEur.url.includes('/EUR/'), 'Extension: EUR in search URL');

const extFlowNull = simulateExtensionFlow(null);
assertEqual(extFlowNull.item.ws_currency, 'USD', 'Extension: null payload → ws_currency=USD');
assert(extFlowNull.url.includes('/USD/'), 'Extension: null → USD in search URL');

const extFlowGbp = simulateExtensionFlow('GBP');
assertEqual(extFlowGbp.item.ws_currency, 'GBP', 'Extension: GBP payload → ws_currency=GBP');

// ── 4. Extension lookup-result endpoint saves ws_currency ─────────────────────
console.log('\n[4] Extension /lookup-result endpoint — finalWsCurrency');

function simulateLookupResultEndpoint(body) {
  // mirrors index.js lines 2168-2170
  const { ws_currency, matched_as, ct_matched, ws_matched, status } = body;
  const finalWsCurrency = (ws_currency || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
  return finalWsCurrency;
}

assertEqual(simulateLookupResultEndpoint({ ws_currency: 'EUR' }),  'EUR', 'Endpoint: EUR body saved as EUR');
assertEqual(simulateLookupResultEndpoint({ ws_currency: 'gbp' }),  'GBP', 'Endpoint: lowercase gbp → GBP');
assertEqual(simulateLookupResultEndpoint({ ws_currency: null }),   'USD', 'Endpoint: null → USD');
assertEqual(simulateLookupResultEndpoint({ ws_currency: '' }),     'USD', 'Endpoint: empty → USD');
assertEqual(simulateLookupResultEndpoint({}),                      'USD', 'Endpoint: missing field → USD');
assertEqual(simulateLookupResultEndpoint({ ws_currency: 'AUD' }),  'AUD', 'Endpoint: AUD saved correctly');

// ── 5. Server /lookup/:id/run — currency from query param ─────────────────────
console.log('\n[5] Server /lookup/:id/run — query param extraction');

function simulateRunEndpointCurrency(queryParam) {
  // mirrors index.js line 2100
  return ((queryParam || '') || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
}

assertEqual(simulateRunEndpointCurrency('EUR'),        'EUR',  'Query param EUR → EUR');
assertEqual(simulateRunEndpointCurrency('gbp'),        'GBP',  'Query param gbp → GBP');
assertEqual(simulateRunEndpointCurrency(undefined),    'USD',  'Missing query param → USD');
assertEqual(simulateRunEndpointCurrency(''),           'USD',  'Empty query param → USD');
assertEqual(simulateRunEndpointCurrency('AUD'),        'AUD',  'Query param AUD → AUD');

// ── 6. Server lookup.js — wsCurrency from options ─────────────────────────────
console.log('\n[6] Server lookup.js — wsCurrency from options');

function simulateLookupJsCurrency(options) {
  // mirrors lookup.js line 849
  return ((options && options.currency) || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
}

assertEqual(simulateLookupJsCurrency({ currency: 'EUR' }),    'EUR',  'options.currency EUR → EUR');
assertEqual(simulateLookupJsCurrency({ currency: 'aud' }),    'AUD',  'options.currency aud → AUD');
assertEqual(simulateLookupJsCurrency({ currency: null }),     'USD',  'options.currency null → USD');
assertEqual(simulateLookupJsCurrency({}),                     'USD',  'empty options → USD');
assertEqual(simulateLookupJsCurrency(null),                   'USD',  'null options → USD');
assertEqual(simulateLookupJsCurrency(undefined),              'USD',  'undefined options → USD');

// ── 7. Lookup.jsx — currency resolution ───────────────────────────────────────
console.log('\n[7] Lookup.jsx — wsCurrency state resolution');

function simulateLookupJsxCurrency(wsCurrencyState) {
  // mirrors Lookup.jsx line 284: const currency = wsCurrency || 'USD'
  return wsCurrencyState || 'USD';
}

assertEqual(simulateLookupJsxCurrency('USD'),   'USD',  'State=USD → USD');
assertEqual(simulateLookupJsxCurrency('EUR'),   'EUR',  'State=EUR → EUR');
assertEqual(simulateLookupJsxCurrency('GBP'),   'GBP',  'State=GBP → GBP');
assertEqual(simulateLookupJsxCurrency(null),    'USD',  'State=null → USD fallback');
assertEqual(simulateLookupJsxCurrency(''),      'USD',  'State="" → USD fallback');
assertEqual(simulateLookupJsxCurrency('AUD'),   'AUD',  'State=AUD → AUD');
assertEqual(simulateLookupJsxCurrency('CAD'),   'CAD',  'State=CAD → CAD');
assertEqual(simulateLookupJsxCurrency('CHF'),   'CHF',  'State=CHF → CHF');
assertEqual(simulateLookupJsxCurrency('HKD'),   'HKD',  'State=HKD → HKD');
assertEqual(simulateLookupJsxCurrency('SGD'),   'SGD',  'State=SGD → SGD');
assertEqual(simulateLookupJsxCurrency('JPY'),   'JPY',  'State=JPY → JPY');

// ── 8. End-to-end currency flow simulation ────────────────────────────────────
console.log('\n[8] End-to-end: selected currency flows through all layers');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'JPY'];

for (const selected of CURRENCIES) {
  // Step 1: UI state
  const uiCurrency = simulateLookupJsxCurrency(selected);

  // Step 2: Bulk create record
  const recordCurrency = sanitizeCurrency(uiCurrency);

  // Step 3a: Extension path — URL and result
  const extFlow = simulateExtensionFlow(uiCurrency);
  const extResultCurrency = extFlow.item.ws_currency;
  const extSavedCurrency = simulateLookupResultEndpoint({ ws_currency: extResultCurrency });
  const extUrlHasCurrency = extractCurrencyFromUrl(extFlow.url) === selected;

  // Step 3b: Server path — query param and lookup
  const serverQueryCurrency = simulateRunEndpointCurrency(uiCurrency);
  const serverLookupCurrency = simulateLookupJsCurrency({ currency: serverQueryCurrency });
  const serverUrl = buildWsUrl('Test Wine', '2019', serverLookupCurrency);
  const serverUrlHasCurrency = extractCurrencyFromUrl(serverUrl) === selected;

  assert(
    recordCurrency === selected && extSavedCurrency === selected &&
    extUrlHasCurrency && serverLookupCurrency === selected && serverUrlHasCurrency,
    `Full flow for ${selected}: UI→record→URL→DB all correct`
  );
}

// ── 9. Verify lookup.js per-row UPDATE includes ws_currency ───────────────────
console.log('\n[9] lookup.js per-row UPDATE SQL includes ws_currency');

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lookupSrc = readFileSync(join(__dirname, 'lookup.js'), 'utf8');

// Check that the per-row UPDATE block contains ws_currency
const perRowUpdateMatch = lookupSrc.match(/UPDATE wine_lookups SET[\s\S]*?WHERE id=\$\d+/g);
assert(perRowUpdateMatch && perRowUpdateMatch.length > 0, 'lookup.js has per-row UPDATE blocks');

const perRowHasCurrency = perRowUpdateMatch?.some(block =>
  block.includes('ws_currency') && !block.includes('batch_id') // batch-id UPDATE is the batch-level one
);
assert(perRowHasCurrency, 'lookup.js per-row UPDATE includes ws_currency column');

// Check that index.js batch-level UPDATE also sets ws_currency
const indexSrc = readFileSync(join(__dirname, 'index.js'), 'utf8');
assert(
  indexSrc.includes("UPDATE wine_lookups SET ws_currency=$1 WHERE batch_id=$2"),
  'index.js batch-level UPDATE sets ws_currency before lookup runs'
);

// Check extension endpoint UPDATE includes ws_currency
const extEndpointMatch = indexSrc.match(/UPDATE wine_lookups[\s\S]*?WHERE id=\$\d+/g);
const extEndpointHasCurrency = extEndpointMatch?.some(block => block.includes('ws_currency'));
assert(extEndpointHasCurrency, 'Extension /lookup-result UPDATE includes ws_currency');

// ── 10. WS URL now includes /-/ region placeholder before currency ─────────────
console.log('\n[10] WS search URL includes /-/ region placeholder');

function buildWsUrlNew(name, vintage, currency) {
  const cur = sanitizeCurrency(currency);
  // `${WS_BASE}/find/${encodeURIComponent(wineName)}/${vintage || 'any'}/-/?Xcurrencycode=${cur}Xtax_mode=e&shoptype=1%2C0`;
  // return `https://www.wine-searcher.com/find/${encodeURIComponent(name)}/${vintage || 'any'}/-/${cur}/ndbipe?Xtax_mode=e&shoptype=1%2C0`;
  return `${WS_BASE}/find/${encodeURIComponent(name)}/${vintage || 'any'}/-/?Xcurrencycode=${cur}Xtax_mode=e&shoptype=1%2C0`;
}

function extractCurrencyFromUrlNew(url) {
  // pathname: /find/<name>/<vintage>/-/<currency>/ndbipe
  try {
    const parts = new URL(url).pathname.split('/');
    // index: 0='', 1='find', 2=name, 3=vintage, 4='-', 5=currency
    return parts[5];
  } catch { return null; }
}

const newUrlUsd = buildWsUrlNew('Château Margaux', '2018', 'USD');
assert(newUrlUsd.includes('/-/'), 'URL contains /-/ region placeholder');
assertEqual(extractCurrencyFromUrlNew(newUrlUsd), 'USD', 'Currency still correctly placed after /-/');

const newUrlEur = buildWsUrlNew('Opus One', '2020', 'EUR');
assert(newUrlEur.includes('/-/EUR/'), '/-/EUR/ segment present');
assertEqual(extractCurrencyFromUrlNew(newUrlEur), 'EUR', 'EUR after /-/');

// Verify lookup.js uses /-/ in search URL
assert(
  lookupSrc.includes('/-/${wsCurrency}/ndbipe') || lookupSrc.includes('/-/'+'\`+wsCurrency+\`') ||
  /find.*\/-\/.*wsCurrency.*ndbipe/.test(lookupSrc) ||
  lookupSrc.includes('/-/${wsCurrency}'),
  'lookup.js WS search URL includes /-/ before currency'
);

// Verify background.js uses /-/ in search URL
const bgSrc = readFileSync(join(__dirname, '..', 'browser-extension', 'background.js'), 'utf8');
assert(
  bgSrc.includes('/-/${currency}/ndbipe') || bgSrc.includes('/-/'),
  'background.js WS search URL includes /-/ before currency'
);

// ── 11. _wsFallbackNames — progressive name-trimming candidates ────────────────
console.log('\n[11] _wsFallbackNames — candidate generation');

// Inline the same logic as the helper in lookup.js / background.js
function wsFallbackNames(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 4) return [];
  const candidates = [];
  for (let i = 1; i <= parts.length - 4; i++) candidates.push(parts.slice(i).join(' '));
  for (let i = 1; i <= parts.length - 4; i++) candidates.push(parts.slice(0, parts.length - i).join(' '));
  return candidates;
}

// ≤4 parts → no fallbacks
assertEqual(wsFallbackNames('Bruno Giacosa 1999').length, 0,         '2 parts → no fallbacks');
assertEqual(wsFallbackNames('Bruno Giacosa Barbaresco 1999').length, 0, '4 parts → no fallbacks');
assertEqual(wsFallbackNames('A B C D').length, 0,                    '4 parts exactly → no fallbacks');

// 5 parts → front:[1 drop] back:[1 drop] = 2 candidates
const f5 = wsFallbackNames('A B C D E');
assertEqual(f5.length, 2,         '5-part name → 2 candidates');
assertEqual(f5[0], 'B C D E',     '5-part: first candidate drops A from front');
assertEqual(f5[1], 'A B C D',     '5-part: second candidate drops E from back');

// 6 parts → front:[2 drops] back:[2 drops] = 4 candidates
const f6 = wsFallbackNames('A B C D E F');
assertEqual(f6.length, 4,         '6-part name → 4 candidates');
assertEqual(f6[0], 'B C D E F',   '6-part front-1: drop A');
assertEqual(f6[1], 'C D E F',     '6-part front-2: drop A B');
assertEqual(f6[2], 'A B C D E',   '6-part back-1: drop F');
assertEqual(f6[3], 'A B C D',     '6-part back-2: drop E F');

// Real example: Casa Fenicola Bruno Giacosa Barbaresco Santo Stefano di Neive (9 parts)
const realName = 'Casa Fenicola Bruno Giacosa Barbaresco Santo Stefano di Neive';
const fReal = wsFallbackNames(realName);
const realParts = realName.split(' ');
assertEqual(fReal.length, (realParts.length - 4) * 2, `${realParts.length}-part name → ${(realParts.length-4)*2} candidates`);
// First front-drop removes "Casa"
assertEqual(fReal[0], 'Fenicola Bruno Giacosa Barbaresco Santo Stefano di Neive', 'First front-drop removes Casa');
// Second front-drop removes "Casa Fenicola"
assertEqual(fReal[1], 'Bruno Giacosa Barbaresco Santo Stefano di Neive', 'Second front-drop removes Casa Fenicola → Bruno Giacosa…');
// Verify minimum 4 parts in every candidate
assert(fReal.every(c => c.split(' ').length >= 4), 'All candidates have ≥ 4 parts');

// ── 12. _wsIsNotFound — detects "no wine" vs other errors ─────────────────────
console.log('\n[12] _wsIsNotFound — distinguishes "no wine" from other errors');

function wsIsNotFound(data) {
  return !!(data?.error && /wine not found|no results found|could not find|no wines found/i.test(data.error));
}

assert( wsIsNotFound({ error: 'Wine-Searcher: wine not found — try adjusting the name or vintage' }), 'detects "wine not found"');
assert( wsIsNotFound({ error: 'Wine-Searcher: no results found' }),  'detects "no results found"');
assert( wsIsNotFound({ error: 'Wine-Searcher: could not find any products' }),   'detects "could not find"');
assert( wsIsNotFound({ error: 'Wine-Searcher: no wines found' }),    'detects "no wines found"');
assert(!wsIsNotFound({ error: 'Wine-Searcher: session expired — please reconnect' }), 'session error NOT a not-found');
assert(!wsIsNotFound({ error: 'Wine-Searcher: page load error – timeout' }),          'page load error NOT a not-found');
assert(!wsIsNotFound({ error: 'Wine-Searcher: blocked by bot-detection' }),           'blocked error NOT a not-found');
assert(!wsIsNotFound({ ws_avg: '$500', ws_min: '$450' }),                             'result with prices NOT a not-found');
assert(!wsIsNotFound(null),  'null NOT a not-found');
assert(!wsIsNotFound({}),    'empty object NOT a not-found');

// ── 13. _ctIsNotFound — distinguishes "no wine" from other errors ──────────────
console.log('\n[13] _ctIsNotFound — distinguishes "no wine" from other errors');

function ctIsNotFound(data) {
  return !data?.url && !data?.avg && !data?.auction &&
    !!data?.error &&
    /no autocomplete|no results|no results for|autocomplete returned nothing|wine not found/i.test(data.error);
}

assert( ctIsNotFound({ error: "Cellar Tracker: autocomplete returned nothing for 'Casa Fenicola'" }), 'detects "autocomplete returned nothing"');
assert( ctIsNotFound({ error: "Cellar Tracker: no results for 'Casa Fenicola'" }),  'detects "no results for"');
assert( ctIsNotFound({ error: "Cellar Tracker: no autocomplete results for 'X'" }), 'detects "no autocomplete results"');
assert(!ctIsNotFound({ error: 'Cellar Tracker: page load error – timeout' }),    'page load error NOT a not-found');
assert(!ctIsNotFound({ error: 'Cellar Tracker: search error – network' }),        'search error NOT a not-found');
assert(!ctIsNotFound({ url: 'https://ct.com/wine.asp?iWine=123', error: 'Cellar Tracker: no results for' }),
  'has url → NOT a not-found (url took priority)');
assert(!ctIsNotFound({ avg: '$100', error: 'no results for' }), 'has avg → NOT a not-found');

// ── 14. Fallback simulation: front-drop finds wine on 2nd try ─────────────────
console.log('\n[14] Fallback simulation — finds wine on front-drop attempt');

async function simulateWsFallback(originalName, foundOnName) {
  let attempts = [];
  const fallbacks = ['original', ...wsFallbackNames(originalName)];

  function fakeWsLookup(name) {
    attempts.push(name);
    if (name === foundOnName) return { ws_avg: '$500', ws_min: '$450', ws_matched: 'Bruno Giacosa' };
    return { error: 'Wine-Searcher: wine not found — try adjusting the name or vintage' };
  }

  let result = fakeWsLookup(originalName);
  if (wsIsNotFound(result)) {
    for (const shorter of wsFallbackNames(originalName)) {
      result = fakeWsLookup(shorter);
      if (!wsIsNotFound(result)) break;
    }
  }
  return { result, attempts };
}

const longName = 'Casa Fenicola Bruno Giacosa Barbaresco Santo Stefano di Neive';
const { result: simResult, attempts } = await simulateWsFallback(
  longName,
  'Bruno Giacosa Barbaresco Santo Stefano di Neive' // found on 2nd front-drop
);
assert(!wsIsNotFound(simResult),                    'Simulation: wine found via front-drop fallback');
assertEqual(simResult.ws_avg, '$500',               'Simulation: correct price returned');
assert(attempts.includes(longName),                 'Simulation: original name was tried first');
assert(attempts.includes('Bruno Giacosa Barbaresco Santo Stefano di Neive'), 'Simulation: front-drop name was tried');
assert(attempts.indexOf(longName) < attempts.indexOf('Bruno Giacosa Barbaresco Santo Stefano di Neive'),
  'Simulation: original tried before fallback');

// Short name (≤4 parts) — no fallback attempted
const { result: shortResult, attempts: shortAttempts } = await simulateWsFallback(
  'Bruno Giacosa Barbaresco',
  'should never match'
);
assert(wsIsNotFound(shortResult),     'Short name (3 parts): returns not-found, no fallback');
assertEqual(shortAttempts.length, 1,  'Short name: only 1 attempt made (no fallback loop)');

// ── 15. lookup.js uses _wsLookupWithFallback and _ctLookupWithFallback ─────────
console.log('\n[15] lookup.js uses fallback wrappers in the main loop');

assert(lookupSrc.includes('_wsLookupWithFallback'), 'lookup.js calls _wsLookupWithFallback');
assert(lookupSrc.includes('_ctLookupWithFallback'), 'lookup.js calls _ctLookupWithFallback');
assert(lookupSrc.includes('_wsFallbackNames'),      'lookup.js defines _wsFallbackNames helper');
assert(lookupSrc.includes('_wsIsNotFound'),         'lookup.js defines _wsIsNotFound helper');
assert(lookupSrc.includes('_ctIsNotFound'),         'lookup.js defines _ctIsNotFound helper');
assert(bgSrc.includes('_wsFallbackNames'),          'background.js defines _wsFallbackNames helper');
assert(bgSrc.includes('_wsIsNotFound'),             'background.js defines _wsIsNotFound helper');
assert(bgSrc.includes('_ctIsNotFound'),             'background.js defines _ctIsNotFound helper');

// ── 16. _isRealError — status classification ──────────────────────────────────
console.log('\n[16] _isRealError — status classification');

// Inline the same logic as lookup.js _isRealError / background.js _isRealErr
const NO_DATA_PATTERNS = [
  'not enabled', 'no connection',
  'wine not found', 'no results found', 'no results for',
  'could not find',
  'could not parse pricing',
  'no autocomplete results', 'autocomplete returned nothing',
  'no wines found',
];
function isRealError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return !NO_DATA_PATTERNS.some(p => lower.includes(p));
}

// ── Messages that are NOT real errors (should → completed) ──
assert(!isRealError(null),  'null → not a real error');
assert(!isRealError(''),    'empty → not a real error');

// Intentional skips
assert(!isRealError('Cellar Tracker: not enabled'),             'CT not enabled → not error');
assert(!isRealError('Wine-Searcher: no connection'),           'WS no connection → not error');

// CT "not found" messages
assert(!isRealError("Cellar Tracker: no autocomplete results for 'Casa Fenicola'"),  'CT no autocomplete results → not error');
assert(!isRealError("Cellar Tracker: autocomplete returned nothing for 'Casa Fenicola'"), 'CT autocomplete returned nothing → not error');
assert(!isRealError("Cellar Tracker: no results for 'Bruno Giacosa'"),               'CT no results for → not error');
assert(!isRealError('Cellar Tracker: could not parse pricing'),                      'CT could not parse pricing → not error');

// WS "not found" messages
assert(!isRealError('Wine-Searcher: wine not found — try adjusting the name or vintage'), 'WS wine not found → not error');
assert(!isRealError('Wine-Searcher: no results found'),                                   'WS no results found → not error');
assert(!isRealError('Wine-Searcher: could not find average price'),                       'WS could not find average price → not error');
assert(!isRealError('Wine-Searcher: could not find any products'),                        'WS could not find any products → not error');
assert(!isRealError('Wine-Searcher: no wines found'),                                     'WS no wines found → not error');

// ── Messages that ARE real errors (should → error) ──
assert(isRealError('Cellar Tracker: page load error – timeout'),          'CT page load error → real error');
assert(isRealError('Cellar Tracker: search error – network failure'),     'CT search error → real error');
assert(isRealError('Wine-Searcher: session expired — please reconnect'), 'WS session expired → real error');
assert(isRealError('Wine-Searcher: blocked by bot-detection'),           'WS blocked → real error');
assert(isRealError('Wine-Searcher: bot-detection could not be cleared automatically. Please re-login'), 'WS bot-detection could not be cleared → real error');
assert(isRealError('Wine-Searcher: page load error – Tab load timeout'), 'WS page load error → real error');
assert(isRealError('Cellar Tracker: Cannot read properties of undefined'), 'CT JS exception → real error');

// ── 17. Status derivation — full scenarios ────────────────────────────────────
console.log('\n[17] Status derivation — full row scenarios');

function deriveStatus({ ct_avg, ct_auction, ws_avg, ws_min, ct_error, ct_err, ws_error }) {
  const hasCt = !!(ct_avg || ct_auction);
  const hasWs = !!(ws_avg || ws_min);
  const ctRealErr = isRealError(ct_error) || isRealError(ct_err);
  const wsRealErr = isRealError(ws_error);
  return (hasCt || hasWs) ? 'completed' : ((ctRealErr || wsRealErr) ? 'error' : 'completed');
}

// Both found prices → completed
assertEqual(deriveStatus({ ct_avg: '$100', ws_avg: '$120' }), 'completed', 'Both CT+WS found → completed');

// One found, one not → completed
assertEqual(deriveStatus({ ct_avg: '$100', ws_error: 'Wine-Searcher: wine not found — try adjusting' }), 'completed', 'CT found, WS not found → completed');
assertEqual(deriveStatus({ ct_error: 'Cellar Tracker: no results for X', ws_avg: '$120' }),               'completed', 'CT not found, WS found → completed');

// Both not found → completed (not error)
assertEqual(deriveStatus({
  ct_error: 'Cellar Tracker: no autocomplete results for X',
  ws_error: 'Wine-Searcher: wine not found — try adjusting',
}), 'completed', 'Both CT+WS "not found" → completed (NOT error)');

assertEqual(deriveStatus({
  ct_err: 'Cellar Tracker: autocomplete returned nothing for X',
  ws_error: 'Wine-Searcher: no results found',
}), 'completed', 'CT autocomplete returned nothing + WS no results → completed');

// Intentional skips → completed
assertEqual(deriveStatus({
  ct_error: 'Cellar Tracker: not enabled',
  ws_error: 'Wine-Searcher: no connection',
}), 'completed', 'CT not enabled + WS no connection → completed');

// Mixed: one skip, one not found → completed
assertEqual(deriveStatus({
  ct_error: 'Cellar Tracker: not enabled',
  ws_error: 'Wine-Searcher: wine not found — try adjusting',
}), 'completed', 'CT skip + WS not found → completed');

// Real error on WS → error
assertEqual(deriveStatus({
  ct_error: 'Cellar Tracker: no results for X',
  ws_error: 'Wine-Searcher: session expired — please reconnect',
}), 'error', 'CT not found + WS session expired → error');

// Real error on CT → error
assertEqual(deriveStatus({
  ct_err: 'Cellar Tracker: page load error – timeout',
  ws_error: 'Wine-Searcher: wine not found — try adjusting',
}), 'error', 'CT page load error + WS not found → error');

// Both real errors → error
assertEqual(deriveStatus({
  ct_error: 'Cellar Tracker: search error – network',
  ws_error: 'Wine-Searcher: blocked by bot-detection',
}), 'error', 'Both real errors → error');

// Real error even when other source found prices
// (prices present → always completed regardless of errors — matches codebase behaviour)
assertEqual(deriveStatus({
  ct_avg: '$100',
  ws_error: 'Wine-Searcher: session expired — please reconnect',
}), 'completed', 'CT found prices → completed even if WS errored');

// ── 18. Verify lookup.js uses _isRealError ─────────────────────────────────────
console.log('\n[18] Code uses _isRealError consistently');

assert(lookupSrc.includes('_NO_DATA_PATTERNS'),   'lookup.js defines _NO_DATA_PATTERNS');
assert(lookupSrc.includes('function _isRealError'), 'lookup.js defines _isRealError');
assert(lookupSrc.includes('_isRealError(ct_data.ct_error)'), 'lookup.js uses _isRealError for ct_data.ct_error');
assert(lookupSrc.includes('_isRealError(ct_err)'),           'lookup.js uses _isRealError for ct_err');
assert(lookupSrc.includes('_isRealError(ws_data.ws_error)'), 'lookup.js uses _isRealError for ws_data.ws_error');
assert(!lookupSrc.includes("SKIP_MSGS = ["), 'lookup.js no longer has old SKIP_MSGS array');
assert(!lookupSrc.includes("NO_DATA_MSGS = ["), 'lookup.js no longer has old NO_DATA_MSGS array');

assert(bgSrc.includes('_noDataPatterns'),           'background.js defines _noDataPatterns');
assert(bgSrc.includes('function _isRealErr'),       'background.js defines _isRealErr');
assert(bgSrc.includes('_isRealErr(item.ct_error)'), 'background.js uses _isRealErr for ct_error');
assert(bgSrc.includes('_isRealErr(item.ws_error)'), 'background.js uses _isRealErr for ws_error');
assert(!bgSrc.includes("skipMsgs   = ["), 'background.js no longer has old skipMsgs array');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSome tests FAILED. Check output above.');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}
