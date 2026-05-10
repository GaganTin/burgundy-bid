// Tests for lookup limit enforcement and data-retention logic
// Run: node server/test-lookup-limits.js

let passed = 0, failed = 0;
function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    got:      ${JSON.stringify(actual)}`); failed++; }
}

// ── 1. normalizePlan ────────────────────────────────────────────────────────
// Mirrors the function in server/index.js
function normalizePlan(raw) {
  return (raw || 'free').toLowerCase().replace(/_(monthly|annually|annual|yearly)$/, '');
}

console.log('\nTest suite 1: normalizePlan()');
assert('free            → free',  normalizePlan('free'),             'free');
assert('basic           → basic', normalizePlan('basic'),            'basic');
assert('pro             → pro',   normalizePlan('pro'),              'pro');
assert('basic_monthly   → basic', normalizePlan('basic_monthly'),    'basic');
assert('basic_annually  → basic', normalizePlan('basic_annually'),   'basic');
assert('basic_annual    → basic', normalizePlan('basic_annual'),     'basic');
assert('basic_yearly    → basic', normalizePlan('basic_yearly'),     'basic');
assert('pro_monthly     → pro',   normalizePlan('pro_monthly'),      'pro');
assert('pro_annually    → pro',   normalizePlan('pro_annually'),     'pro');
assert('null            → free',  normalizePlan(null),               'free');
assert('undefined       → free',  normalizePlan(undefined),          'free');
assert('FREE (upper)    → free',  normalizePlan('FREE'),             'free');
assert('PRO_MONTHLY     → pro',   normalizePlan('PRO_MONTHLY'),      'pro');

// ── 2. Limit enforcement logic ──────────────────────────────────────────────
// Mirrors the core decision logic in checkLookupLimit()
function checkLimit(used, limit, batchSize = 0, plan = 'free') {
  const remaining = Math.max(0, limit - used);
  if (used >= limit) {
    return { allowed: false, reason: `Monthly lookup limit reached (${limit} on ${plan} plan). Upgrade to continue.`, used, limit, remaining: 0, plan };
  }
  if (batchSize > 0 && batchSize > remaining) {
    return { allowed: false, reason: `Batch of ${batchSize} exceeds ${remaining} remaining (${used}/${limit} on ${plan} plan).`, used, limit, remaining, plan };
  }
  return { allowed: true, used, limit, remaining, plan };
}

console.log('\nTest suite 2: Limit enforcement — Free plan (20 lifetime total)');
assert('0/20  → allowed',   checkLimit(0,  20).allowed,  true);
assert('19/20 → allowed',   checkLimit(19, 20).allowed,  true);
assert('20/20 → blocked',   checkLimit(20, 20).allowed,  false);
assert('21/20 → blocked',   checkLimit(21, 20).allowed,  false);
assert('20/20 has reason',  checkLimit(20, 20).reason !== undefined, true);

console.log('\nTest suite 3: Limit enforcement — Basic plan (2,000/month)');
assert('0/2000     → allowed', checkLimit(0,    2000, 0, 'basic').allowed, true);
assert('1999/2000  → allowed', checkLimit(1999, 2000, 0, 'basic').allowed, true);
assert('2000/2000  → blocked', checkLimit(2000, 2000, 0, 'basic').allowed, false);
assert('2001/2000  → blocked', checkLimit(2001, 2000, 0, 'basic').allowed, false);

console.log('\nTest suite 4: Limit enforcement — Pro plan (20,000/month)');
assert('0/20000      → allowed', checkLimit(0,     20000, 0, 'pro').allowed, true);
assert('19999/20000  → allowed', checkLimit(19999, 20000, 0, 'pro').allowed, true);
assert('20000/20000  → blocked', checkLimit(20000, 20000, 0, 'pro').allowed, false);

console.log('\nTest suite 5: Batch size enforcement');
assert('batch=5, remaining=5  → allowed', checkLimit(15,   20, 5,  'free').allowed, true);
assert('batch=6, remaining=5  → blocked', checkLimit(15,   20, 6,  'free').allowed, false);
assert('batch=1, remaining=0  → blocked', checkLimit(20,   20, 1,  'free').allowed, false);
assert('batch=200, rem=201    → allowed', checkLimit(1799, 2000, 200, 'basic').allowed, true);
assert('batch=201, rem=200    → blocked', checkLimit(1800, 2000, 201, 'basic').allowed, false);
assert('blocked msg has count', checkLimit(15, 20, 6, 'free').reason.includes('6'), true);

// ── 3. Data-retention plan targeting ────────────────────────────────────────
// All plans (free, basic, pro) are now cleaned up after 6 months.
function shouldCleanup(rawPlan) {
  const p = normalizePlan(rawPlan);
  return p === 'free' || p === 'basic' || p === 'pro';
}

console.log('\nTest suite 6: Data retention — which plans are cleaned up');
assert('free           → delete',     shouldCleanup('free'),           true);
assert('null           → delete',     shouldCleanup(null),             true);
assert('basic          → delete',     shouldCleanup('basic'),          true);
assert('pro            → delete',     shouldCleanup('pro'),            true);
assert('basic_monthly  → delete',     shouldCleanup('basic_monthly'),  true);
assert('basic_annually → delete',     shouldCleanup('basic_annually'), true);
assert('pro_monthly    → delete',     shouldCleanup('pro_monthly'),    true);
assert('pro_annually   → delete',     shouldCleanup('pro_annually'),   true);
assert('FREE (upper)   → delete',     shouldCleanup('FREE'),           true);

// ── 4. Enforcement coverage audit ───────────────────────────────────────────
// Verify that limit checks happen at BOTH expected enforcement points.
console.log('\nTest suite 7: Enforcement coverage audit (static code check)');
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

const bulkEndpoint = '/entities/:entity/bulk';
const runEndpoint  = '/lookup/:id/run';

// Both enforcement points must call checkLookupLimit
const bulkIdx  = indexSrc.indexOf(bulkEndpoint);
const runIdx   = indexSrc.indexOf(runEndpoint);

function sliceAround(src, idx, window = 600) {
  return src.slice(Math.max(0, idx), idx + window);
}

assert('Primary check: bulk endpoint calls checkLookupLimit',
  sliceAround(indexSrc, bulkIdx).includes('checkLookupLimit'), true);
assert('Secondary check: run endpoint calls checkLookupLimit',
  sliceAround(indexSrc, runIdx).includes('checkLookupLimit'), true);
assert('Both checks return 402 on limit exceeded',
  (indexSrc.match(/res\.status\(402\)/g) || []).length >= 2, true);
assert('Admin users bypass limit at bulk endpoint',
  sliceAround(indexSrc, bulkIdx).includes("role_type !== 'admin'"), true);
assert('Admin users bypass limit at run endpoint',
  sliceAround(indexSrc, runIdx).includes("role_type !== 'admin'"), true);

// deleteOldLookups must exist and apply to all plans (no plan filter)
assert('soft-delete lookup job defined',     indexSrc.includes('jobSoftDeleteOldLookups'), true);
assert('Cleanup uses 6 months interval',     indexSrc.includes("INTERVAL '6 months'"), true);
assert('Cleanup runs every 24h',             indexSrc.includes('24 * 60 * 60 * 1000'), true);
assert('No plan filter — applies to all',   !indexSrc.includes("ILIKE 'basic%'"),   true);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
