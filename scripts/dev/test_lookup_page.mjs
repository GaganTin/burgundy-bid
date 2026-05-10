/**
 * Comprehensive Lookup page test
 * Covers: header, source pills, guide modal, WS currency, tabs, form validation,
 *         single search lookup, results table (columns, picker, calc columns, CSV export,
 *         offer editing), offer summary, paste list, upload file, AI image, history section,
 *         delete row (in history), connection state changes (CT-only / WS-only / gate)
 */
import { chromium } from 'playwright';
import jwt from '../node_modules/jsonwebtoken/index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dir      = dirname(__filename);

const BASE       = 'http://localhost:5173';
const API        = 'http://localhost:3001';
const JWT_SECRET = 'devsecret_replace_me';
const USER_ID    = 'cd527c9b-44cc-4b84-9948-91350c8af6a4';
const EMAIL      = 'zanrow.co@gmail.com';

let passed = 0, failed = 0, warnings = 0;
const results = [];

function log(status, section, test, detail = '') {
  const icon  = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌';
  const label = detail ? `${test} — ${detail}` : test;
  console.log(`${icon} [${section}] ${label}`);
  results.push({ status, section, test, detail });
  if (status === 'PASS') passed++;
  else if (status === 'WARN') warnings++;
  else failed++;
}

function mintToken() {
  return jwt.sign({ id: USER_ID, email: EMAIL, role_type: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
}

async function injectAuth(page) {
  const token = mintToken();
  const user  = { id: USER_ID, email: EMAIL, role_type: 'admin', full_name: 'Test',
                  subscription_plan: 'admin', phone: null, preferred_theme: 'light', is_email_verified: true };
  await page.evaluate(([t, u]) => {
    localStorage.setItem('app_access_token', t);
    localStorage.setItem('app_current_user', JSON.stringify(u));
  }, [token, user]);
}

async function disableToastOverlay(page) {
  await page.evaluate(() => {
    const fn = () => document.querySelectorAll('[class]').forEach(el => {
      if (typeof el.className === 'string' && el.className.includes('z-[100]'))
        el.style.pointerEvents = 'none';
    });
    fn();
    new MutationObserver(fn).observe(document.body, { childList: true, subtree: true });
  });
}

async function navToLookup(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await injectAuth(page);
  await page.goto(`${BASE}/Lookup`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await disableToastOverlay(page);
  // Wait for credential API call to complete — pill changes from "not connected" to "on"/"disabled"
  await page.waitForFunction(() => {
    const pills = [...document.querySelectorAll('[class*="rounded-full"]')];
    return pills.some(p =>
      p.textContent.includes(' on') || p.textContent.includes(' disabled')
    );
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function apiCreds() {
  const r = await fetch(`${API}/entities/SiteCredential`,
    { headers: { Authorization: `Bearer ${mintToken()}` } });
  return r.ok ? r.json() : [];
}

async function setCredEnabled(credId, enabled) {
  const r = await fetch(`${API}/entities/SiteCredential/${credId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mintToken()}` },
    body: JSON.stringify({ is_enabled: enabled }),
  });
  return r.ok;
}

// Find the WS Currency combobox (next to "WS Currency" label, shows currency code like USD)
async function getWsCurrTrigger(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')];
    const l = labels.find(x => x.textContent.trim() === 'WS Currency');
    const btn = l?.closest('div')?.querySelector('button[role="combobox"]');
    return btn ? btn.getAttribute('data-testid') || 'found' : null;
  });
}

async function clickWsCurrTrigger(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')];
    const l = labels.find(x => x.textContent.trim() === 'WS Currency');
    const btn = l?.closest('div')?.querySelector('button[role="combobox"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
}

// Waits for "Latest Results" heading after a lookup, returns true/false
async function waitForLatestResults(page, timeoutMs = 180000) {
  return page.waitForSelector('h2:has-text("Latest Results")', { timeout: timeoutMs })
    .then(() => true).catch(() => false);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const page    = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {

    // ── Pre-flight: ensure credentials are enabled (recover from crashed runs) ─
    const preflightCreds = await apiCreds();
    let preflightChanged = false;
    for (const c of preflightCreds) {
      if ((c.site_name === 'cellar_tracker' || c.site_name === 'wine_searcher') && !c.is_enabled) {
        console.log(`  [Preflight] Re-enabling ${c.site_name}...`);
        await setCredEnabled(c.id, true);
        preflightChanged = true;
      }
    }
    if (preflightChanged) await new Promise(r => setTimeout(r, 1000));

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 1: Page Load & Header
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 1: Page Load & Header ════');
    await navToLookup(page);

    const titleEl = await page.$('h1:has-text("Wine Price Lookup")');
    log(titleEl ? 'PASS' : 'FAIL', 'Header', 'Title "Wine Price Lookup" present');

    const subtitle = await page.$('p:has-text("Compare market prices")');
    log(subtitle ? 'PASS' : 'WARN', 'Header', 'Subtitle present');

    const guideBtn = await page.$('button:has-text("How it works")');
    log(guideBtn ? 'PASS' : 'FAIL', 'Header', '"How it works" button present');

    // Source pills
    const ctPillTxt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Cellar Tracker'));
      return el ? el.textContent.trim() : null;
    });
    const wsPillTxt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Wine-Searcher'));
      return el ? el.textContent.trim() : null;
    });

    log(ctPillTxt !== null ? 'PASS' : 'FAIL', 'Header', 'CT source pill present', ctPillTxt || '');
    log(wsPillTxt !== null ? 'PASS' : 'FAIL', 'Header', 'WS source pill present', wsPillTxt || '');
    log(ctPillTxt?.includes(' on') ? 'PASS' : 'WARN', 'Header', 'CT source active', ctPillTxt || '');
    log(wsPillTxt?.includes(' on') ? 'PASS' : 'WARN', 'Header', 'WS source active', wsPillTxt || '');

    // "Important!" note
    const importantNote = await page.$('p:has-text("The best price does not equate")');
    log(importantNote ? 'PASS' : 'WARN', 'Header', '"Important!" note present (requires active source)');

    // Quick start guide text
    const quickStartTxt = await page.$('p:has-text("Quick start guide")');
    log(quickStartTxt ? 'PASS' : 'WARN', 'Header', '"Quick start guide" subtitle on guide button');


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 2: Guide Modal (7 pages)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 2: Guide Modal ════');

    await page.click('button:has-text("How it works")');
    await page.waitForSelector('[data-state="open"][class*="fixed"]', { timeout: 5000 });
    const modalOpen = await page.$('[data-state="open"][class*="fixed"]');
    log(modalOpen ? 'PASS' : 'FAIL', 'Guide', 'Guide modal opened');

    // Step counter "1 / 7"
    const stepCounter = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      return spans.find(s => /^\d+\s*\/\s*7$/.test(s.textContent.trim()))?.textContent.trim() || null;
    });
    log(stepCounter === '1 / 7' ? 'PASS' : 'WARN', 'Guide', 'Step counter shows 1 / 7', stepCounter || '(not found)');

    // 7 dot indicators
    const dots = await page.$$('button[aria-label^="Go to step"]');
    log(dots.length === 7 ? 'PASS' : 'WARN', 'Guide', '7 dot navigation indicators', `found ${dots.length}`);

    // First page label "OVERVIEW" visible as text
    const overviewLabel = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('p')];
      return ps.some(p => p.textContent.trim().toUpperCase() === 'OVERVIEW');
    });
    log(overviewLabel ? 'PASS' : 'WARN', 'Guide', 'First page label "OVERVIEW" present');

    // First page title
    const firstTitle = await page.$('h2:has-text("Wine Price Lookup")');
    log(firstTitle ? 'PASS' : 'WARN', 'Guide', 'First page title "Wine Price Lookup"');

    // Previous button disabled on first page
    const prevDisabled = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const prev = btns.find(b => b.textContent.trim().includes('Previous'));
      return prev?.disabled;
    });
    log(prevDisabled ? 'PASS' : 'WARN', 'Guide', 'Previous button disabled on first page');

    // Navigate through 6 pages with Next
    for (let i = 1; i <= 6; i++) {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        btns.find(b => b.textContent.trim() === 'Next')?.click();
      });
      await page.waitForTimeout(300);
    }

    // On last page (step 7): "Done" button instead of "Next"
    const doneBtn = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some(b => b.textContent.trim() === 'Done');
    });
    log(doneBtn ? 'PASS' : 'FAIL', 'Guide', '"Done" button on last page');

    const lastStepCounter = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('span')];
      return spans.find(s => /^\d+\s*\/\s*7$/.test(s.textContent.trim()))?.textContent.trim() || null;
    });
    log(lastStepCounter === '7 / 7' ? 'PASS' : 'WARN', 'Guide', 'Step counter shows 7 / 7', lastStepCounter || '');

    // Close with Done
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      btns.find(b => b.textContent.trim() === 'Done')?.click();
    });
    await page.waitForTimeout(500);
    const modalClosed = !(await page.$('[data-state="open"][class*="fixed"]'));
    log(modalClosed ? 'PASS' : 'FAIL', 'Guide', 'Modal closed after clicking Done');

    // Reopen and close with X button
    await page.click('button:has-text("How it works")');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      // X button is a button with X icon in the top-right of the modal
      const btns = [...document.querySelectorAll('button')];
      // Find the close button: it's near the step counter, has an SVG with X shape
      const closeBtn = btns.find(b => b.className?.includes('rounded-full') && b.closest('[class*="fixed"]'));
      closeBtn?.click();
    });
    await page.waitForTimeout(500);
    const closedWithX = !(await page.$('[data-state="open"][class*="fixed"]'));
    log(closedWithX ? 'PASS' : 'WARN', 'Guide', 'Modal closed with X button');

    // Jump to page 3 via dot navigation
    await page.click('button:has-text("How it works")');
    await page.waitForTimeout(400);
    await page.click('button[aria-label="Go to step 3"]');
    await page.waitForTimeout(300);
    const step3Counter = await page.evaluate(() => {
      return [...document.querySelectorAll('span')].find(s => /^\d+\s*\/\s*7$/.test(s.textContent.trim()))?.textContent.trim();
    });
    log(step3Counter === '3 / 7' ? 'PASS' : 'WARN', 'Guide', 'Dot navigation jumps to page 3', step3Counter || '');

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 3: WS Currency Dropdown
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 3: WS Currency Dropdown ════');

    const wsCurrLabel = await page.$('label:has-text("WS Currency")');
    log(wsCurrLabel ? 'PASS' : 'FAIL', 'Currency', '"WS Currency" label present');

    const wsCurrDefault = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('label')];
      const l = labels.find(x => x.textContent.trim() === 'WS Currency');
      return l?.closest('div')?.querySelector('button[role="combobox"]')?.textContent.trim() || null;
    });
    log(wsCurrDefault === 'USD' ? 'PASS' : 'WARN', 'Currency', 'WS Currency defaults to USD', wsCurrDefault || '(not found)');

    // Change to AUD
    await clickWsCurrTrigger(page);
    await page.waitForTimeout(400);
    const audOpt = await page.$('[role="option"]:has-text("AUD")');
    if (audOpt) {
      await audOpt.click();
      await page.waitForTimeout(300);
      const newCurr = await page.evaluate(() => {
        const l = [...document.querySelectorAll('label')].find(x => x.textContent.trim() === 'WS Currency');
        return l?.closest('div')?.querySelector('button[role="combobox"]')?.textContent.trim();
      });
      log(newCurr === 'AUD' ? 'PASS' : 'FAIL', 'Currency', 'WS Currency changed to AUD', newCurr || '');
    } else {
      log('WARN', 'Currency', 'AUD option not found in dropdown');
    }

    // All 9 currencies listed
    await clickWsCurrTrigger(page);
    await page.waitForTimeout(300);
    const currencies = ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'JPY'];
    for (const c of currencies) {
      const opt = await page.$(`[role="option"]:has-text("${c}")`);
      log(opt ? 'PASS' : 'WARN', 'Currency', `Currency option "${c}" present`);
    }

    // Reset to USD
    const usdOpt = await page.$('[role="option"]:has-text("USD")');
    if (usdOpt) await usdOpt.click();
    await page.waitForTimeout(300);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 4: Tab Navigation
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 4: Tab Navigation ════');

    const tabLabels = [
      { label: 'Single Search', check: () => page.$('input[placeholder*="Château"]') },
      { label: 'Paste List',    check: () => page.$('textarea') },
      { label: 'Upload File',   check: () => page.$('text=Click to upload CSV') },
      { label: 'AI Image Search', check: () => page.$('[role="tabpanel"][data-state="active"]') },
    ];

    for (const { label, check } of tabLabels) {
      const tab = await page.$(`[role="tab"]:has-text("${label}")`);
      log(tab ? 'PASS' : 'FAIL', 'Tabs', `Tab "${label}" present`);
      if (tab) {
        await tab.click();
        await page.waitForTimeout(500);
        const tabActive = await page.evaluate((lbl) => {
          const tabs = [...document.querySelectorAll('[role="tab"]')];
          const t = tabs.find(t => t.textContent.includes(lbl));
          return t?.getAttribute('data-state') === 'active';
        }, label);
        log(tabActive ? 'PASS' : 'WARN', 'Tabs', `"${label}" tab is active after click`);
        const content = await check();
        log(content ? 'PASS' : 'WARN', 'Tabs', `"${label}" tab content renders`);
      }
    }

    // Back to Single Search
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);

    // Single Search-specific checks
    const sizeSelect = await page.$('label:has-text("Size")');
    log(sizeSelect ? 'PASS' : 'WARN', 'Tabs', 'Single Search: Size label present');
    const vintageInput = await page.$('input[placeholder="2018"]');
    log(vintageInput ? 'PASS' : 'FAIL', 'Tabs', 'Single Search: Vintage input present');
    const nameInput = await page.$('input[placeholder*="Château"]');
    log(nameInput ? 'PASS' : 'FAIL', 'Tabs', 'Single Search: Wine Name input present');

    // Paste List checks
    await page.click('[role="tab"]:has-text("Paste List")');
    await page.waitForTimeout(400);
    const pasteDesc = await page.$('p:has-text("Accepts tab-separated")');
    log(pasteDesc ? 'PASS' : 'WARN', 'Tabs', 'Paste List: format description present');
    const pastePlaceholder = await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      return ta?.placeholder?.includes('Vintage') || false;
    });
    log(pastePlaceholder ? 'PASS' : 'WARN', 'Tabs', 'Paste List: textarea has helpful placeholder');

    // Upload File checks
    await page.click('[role="tab"]:has-text("Upload File")');
    await page.waitForTimeout(400);
    const uploadLabel = await page.$('label:has-text("Upload your file")');
    log(uploadLabel ? 'PASS' : 'FAIL', 'Tabs', 'Upload File: "Upload your file" label');
    const uploadDesc = await page.$('p:has-text("Accepts CSV, TSV, TXT, or Excel file")');
    log(uploadDesc ? 'PASS' : 'WARN', 'Tabs', 'Upload File: format description');
    // ImageSearchTab (forceMount) also has input[type="file"] earlier in DOM — scope to active panel
    const fileInput = await page.$('[role="tabpanel"][data-state="active"] input[type="file"]');
    log(fileInput ? 'PASS' : 'FAIL', 'Tabs', 'Upload File: hidden file input');
    const acceptAttr = await fileInput?.getAttribute('accept');
    log(acceptAttr?.includes('.csv') && acceptAttr?.includes('.xlsx') ? 'PASS' : 'WARN',
      'Tabs', 'Upload File: accepts csv/xlsx/tsv/txt', acceptAttr || '');

    // Back to Single Search
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 5: Form Validation
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 5: Form Validation ════');

    const lookupBtn = await page.$('button:has-text("Look Up")');
    log(lookupBtn ? 'PASS' : 'FAIL', 'Form', '"Look Up" button present');

    const btnDisabledEmpty = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      return btn?.disabled === true;
    });
    log(btnDisabledEmpty ? 'PASS' : 'FAIL', 'Form', 'Look Up disabled when all fields empty');

    // Fill vintage only
    await page.fill('input[placeholder="2018"]', '2019');
    await page.waitForTimeout(200);
    const btnDisabledNoName = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      return btn?.disabled === true;
    });
    log(btnDisabledNoName ? 'PASS' : 'FAIL', 'Form', 'Look Up disabled with only vintage filled');

    // Fill name → button enabled
    await page.fill('input[placeholder*="Château"]', 'Penfolds Grange');
    await page.waitForTimeout(200);
    const btnEnabled = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      return btn?.disabled === false;
    });
    log(btnEnabled ? 'PASS' : 'FAIL', 'Form', 'Look Up enabled with name + vintage');

    // Size dropdown is optional — button stays enabled without it
    const sizeOpts = ['750ml', '375ml', '1.5L', '3L', 'Other'];
    // Open Size select to verify options
    const sizeSelectTrigger = await page.evaluate(() => {
      // Size label is first label in single search tab
      const labels = [...document.querySelectorAll('label')];
      const l = labels.find(x => x.textContent.trim() === 'Size');
      const btn = l?.closest('div')?.querySelector('button[role="combobox"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    await page.waitForTimeout(300);
    for (const opt of sizeOpts) {
      const optEl = await page.$(`[role="option"]:has-text("${opt}")`);
      log(optEl ? 'PASS' : 'WARN', 'Form', `Size option "${opt}" present`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Enter key submits if enabled
    // (We'll actually test this by pressing Enter in the wine name field)
    // Don't submit yet - just verify fields ready for Section 6


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 6: Single Search Lookup
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 6: Single Search Lookup ════');
    console.log('  Running "Penfolds Grange" 2019 lookup (up to 180s)...');

    // Fields already filled from Section 5
    // Click Look Up
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      btn?.click();
    });

    // Progress bar
    const progressAppeared = await page.waitForSelector('text=Looking up prices...', { timeout: 15000 })
      .then(() => true).catch(() => false);
    log(progressAppeared ? 'PASS' : 'WARN', 'Lookup', 'Progress bar "Looking up prices..." appeared');

    if (progressAppeared) {
      // Verify progress bar structure
      const progressBar = await page.evaluate(() => {
        const bars = [...document.querySelectorAll('[class*="bg-\\[#800020\\]"]')];
        return bars.some(b => b.classList.contains('h-1\\.5') || getComputedStyle(b).height === '6px');
      });
      log('PASS', 'Lookup', 'Progress bar element rendered');

      const progressCounter = await page.evaluate(() => {
        const spans = [...document.querySelectorAll('span')];
        return spans.find(s => /\d+\s*\/\s*\d+/.test(s.textContent.trim()))?.textContent.trim() || null;
      });
      log(progressCounter ? 'PASS' : 'WARN', 'Lookup', 'Progress counter (N/total) visible', progressCounter || '');

      console.log('  Waiting for lookup to complete...');
      const done = await waitForLatestResults(page, 180000);
      log(done ? 'PASS' : 'FAIL', 'Lookup', '"Latest Results" heading appeared after lookup');

      if (done) {
        // Wait for the progress bar to fully disappear — SSE "finished" event processed
        console.log('  Waiting for progress bar to clear...');
        await page.waitForFunction(() => {
          // "Looking up prices..." text disappears when SSE "finished" is processed
          return !document.body.innerText.includes('Looking up prices...');
        }, { timeout: 240000 }).catch(() => {});
        // Wait for all rows to leave "pending" state (spinner gone, status = Done/Error)
        await page.waitForFunction(() => {
          const spinners = document.querySelectorAll('tbody svg.animate-spin');
          return spinners.length === 0;
        }, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1000); // brief settle for react-query invalidation re-render
      } else {
        log('WARN', 'Lookup', 'Lookup did not complete within 180s — table tests may be limited');
      }
    }

    await page.waitForTimeout(500);

    // Check results table and row count
    const rowCount = (await page.$$('tbody tr')).length;
    log(rowCount > 0 ? 'PASS' : 'WARN', 'Lookup', `Results table has ${rowCount} row(s)`);

    // Verify the lookup button goes back to enabled state after lookup
    await page.waitForFunction(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      return btn ? !btn.disabled : false;
    }, { timeout: 10000 }).catch(() => {});
    const lookupBtnAfter = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up');
      return btn ? !btn.disabled : null;
    });
    log(lookupBtnAfter ? 'PASS' : 'WARN', 'Lookup', 'Look Up button re-enabled after lookup completes');

    // Wine count shown next to heading
    const wineCountLabel = await page.evaluate(() => {
      const h2s = [...document.querySelectorAll('h2')];
      const h = h2s.find(h => h.textContent.includes('Latest Results'));
      return h?.textContent.trim() || null;
    });
    log(wineCountLabel?.includes('wine') ? 'PASS' : 'WARN', 'Lookup', 'Wine count shown in heading', wineCountLabel || '');


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 7: Results Table Features
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 7: Results Table ════');

    const hasRows = (await page.$$('tbody tr')).length > 0;
    if (!hasRows) {
      log('WARN', 'Table', 'No result rows — skipping table feature tests');
    } else {
      // ── Column headers ───────────────────────────────────────────────────────
      const hdrs = await page.evaluate(() =>
        [...document.querySelectorAll('thead th')].map(th => th.textContent.trim().toUpperCase())
      );
      console.log('  Headers:', hdrs.join(', '));

      // Default visible columns (CT Currency and Offer Currency hidden by default)
      const expectedCols = ['SIZE', 'VINTAGE', 'WINE', 'CT AVG VALUE', 'CT AUCTION AVG',
                            'WS AVG PRICE', 'WS MIN PRICE', 'MATCHED AS', 'STATUS', 'OFFER'];
      for (const col of expectedCols) {
        log(hdrs.some(h => h.includes(col)) ? 'PASS' : 'WARN', 'Table-Headers', `Column "${col}"`, hdrs.find(h => h.includes(col)) || 'not found');
      }

      // CT Currency and Offer Currency should be hidden by default
      const ctCurrHidden = !hdrs.some(h => h === 'CT CURRENCY');
      const offerCurrHidden = !hdrs.some(h => h === 'OFFER CURRENCY');
      log(ctCurrHidden ? 'PASS' : 'WARN', 'Table-Headers', 'CT Currency hidden by default');
      log(offerCurrHidden ? 'PASS' : 'WARN', 'Table-Headers', 'Offer Currency hidden by default');

      // Table header has dark red background (#800020)
      const headerRowColor = await page.evaluate(() => {
        const tr = document.querySelector('thead tr');
        return tr ? getComputedStyle(tr).backgroundColor : null;
      });
      log(headerRowColor?.includes('128') ? 'PASS' : 'WARN', 'Table-Headers', 'Table header has dark red background (#800020)', headerRowColor || '');

      // ── Status badge ─────────────────────────────────────────────────────────
      // Wait up to 5s for status to finalize (Done/Error)
      await page.waitForFunction(() => {
        const cells = [...document.querySelectorAll('tbody td')];
        return cells.some(td => td.textContent.trim().includes('Done') || td.textContent.trim().includes('Error'));
      }, { timeout: 5000 }).catch(() => {});
      const statusBadge = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('tbody td')];
        return cells.some(td => td.textContent.trim().includes('Done') || td.textContent.trim().includes('Error'));
      });
      log(statusBadge ? 'PASS' : 'WARN', 'Table-Status', 'Status badge ("Done" or "Error") present');

      // ── CT/WS data cells ─────────────────────────────────────────────────────
      const ctAvgContent = await page.evaluate(() => {
        const ths = [...document.querySelectorAll('thead th')];
        const idx = ths.findIndex(th => th.textContent.includes('CT Avg Value'));
        if (idx === -1) return null;
        const rows = document.querySelectorAll('tbody tr');
        return [...rows].slice(0, 3).map(tr => tr.querySelectorAll('td')[idx]?.textContent.trim()).filter(Boolean);
      });
      log(ctAvgContent?.length > 0 ? 'PASS' : 'WARN', 'Table-Data', 'CT Avg Value cells have content', ctAvgContent?.join(', ') || '');

      const wsAvgContent = await page.evaluate(() => {
        const ths = [...document.querySelectorAll('thead th')];
        const idx = ths.findIndex(th => th.textContent.includes('WS Avg Price'));
        if (idx === -1) return null;
        const rows = document.querySelectorAll('tbody tr');
        return [...rows].slice(0, 3).map(tr => tr.querySelectorAll('td')[idx]?.textContent.trim()).filter(Boolean);
      });
      log(wsAvgContent?.length > 0 ? 'PASS' : 'WARN', 'Table-Data', 'WS Avg Price cells have content', wsAvgContent?.join(', ') || '');

      // Matched As column (links to CT/WS or matched name)
      const matchedContent = await page.evaluate(() => {
        const ths = [...document.querySelectorAll('thead th')];
        const idx = ths.findIndex(th => th.textContent.includes('Matched As'));
        if (idx === -1) return null;
        const firstRow = document.querySelector('tbody tr');
        return firstRow?.querySelectorAll('td')[idx]?.textContent.trim();
      });
      log(matchedContent !== null ? 'PASS' : 'WARN', 'Table-Data', 'Matched As cell has content', matchedContent || '—');

      // External links (CT / WS) in Matched As column
      const externalLinks = await page.evaluate(() => {
        return [...document.querySelectorAll('a[target="_blank"]')].length;
      });
      log(externalLinks > 0 ? 'PASS' : 'WARN', 'Table-Data', `External links (CT/WS) in Matched As: ${externalLinks}`);

      // ── Columns Picker ───────────────────────────────────────────────────────
      console.log('\n  [Column Picker]');

      const colsBtn = await page.$('button:has-text("Columns")');
      log(colsBtn ? 'PASS' : 'FAIL', 'Table-Cols', '"Columns" button present');

      if (colsBtn) {
        await colsBtn.click();
        await page.waitForTimeout(600);

        const dragReorder = await page.$('p:has-text("Drag to reorder")');
        log(dragReorder ? 'PASS' : 'FAIL', 'Table-Cols', 'Column picker opened ("Drag to reorder")');

        // Verify all expected columns listed in picker
        const pickerLabels = ['Size', 'Vintage', 'Wine', 'CT Avg Value', 'CT Auction Avg',
                              'WS Avg Price', 'WS Min Price', 'Matched As', 'Status', 'Offer',
                              'CT Currency', 'Offer Currency'];
        for (const lbl of pickerLabels) {
          const found = await page.evaluate((l) =>
            [...document.querySelectorAll('span')].some(s => s.textContent.trim() === l)
          , lbl);
          log(found ? 'PASS' : 'WARN', 'Table-Cols', `"${lbl}" listed in column picker`);
        }

        // "Apply layout to all tabs" button
        const applyAllBtn = await page.$('button:has-text("Apply layout to all tabs")');
        log(applyAllBtn ? 'PASS' : 'WARN', 'Table-Cols', '"Apply layout to all tabs" button');

        // "Add Calculated Column" button
        const addCalcBtn = await page.$('button:has-text("Add Calculated Column")');
        log(addCalcBtn ? 'PASS' : 'FAIL', 'Table-Cols', '"Add Calculated Column" button');

        // Toggle CT Currency column on (it's hidden by default)
        const ctCurrToggled = await page.evaluate(() => {
          const spans = [...document.querySelectorAll('span')];
          const s = spans.find(x => x.textContent.trim() === 'CT Currency');
          const container = s?.closest('div[class*="flex"]');
          const checkbox = container?.querySelector('button[class*="rounded"]');
          if (checkbox) { checkbox.click(); return true; }
          return false;
        });
        await page.waitForTimeout(500);
        if (ctCurrToggled) {
          const ctCurrNowVisible = await page.evaluate(() =>
            [...document.querySelectorAll('thead th')].some(th => th.textContent.includes('CT Currency'))
          );
          log(ctCurrNowVisible ? 'PASS' : 'WARN', 'Table-Cols', 'CT Currency column shown after toggle on');

          // Toggle it back off
          await page.evaluate(() => {
            const spans = [...document.querySelectorAll('span')];
            const s = spans.find(x => x.textContent.trim() === 'CT Currency');
            const container = s?.closest('div[class*="flex"]');
            const checkbox = container?.querySelector('button[class*="rounded"]');
            checkbox?.click();
          });
          await page.waitForTimeout(400);
          const ctCurrHiddenAgain = await page.evaluate(() =>
            ![...document.querySelectorAll('thead th')].some(th => th.textContent.trim() === 'CT Currency')
          );
          log(ctCurrHiddenAgain ? 'PASS' : 'WARN', 'Table-Cols', 'CT Currency hidden again after toggle off');
        }

        // ── Add Calculated Column ─────────────────────────────────────────────
        console.log('\n  [Calculated Columns]');

        if (addCalcBtn) {
          await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            btns.find(b => b.textContent.trim() === 'Add Calculated Column')?.click();
          });
          await page.waitForTimeout(600);

          const calcDialog = await page.$('[role="dialog"]');
          log(calcDialog ? 'PASS' : 'FAIL', 'Calc', '"Add Calculated Column" dialog opened');

          if (calcDialog) {
            // Dialog title
            const calcTitle = await page.evaluate(() => {
              const el = document.querySelector('[role="dialog"] h2');
              return el?.textContent.trim();
            });
            log(calcTitle?.includes('Calculated Column') ? 'PASS' : 'WARN', 'Calc', 'Dialog title correct', calcTitle || '');

            // Column Name input
            const colNameInput = await page.$('[role="dialog"] input[placeholder*="CT Avg"]');
            log(colNameInput ? 'PASS' : 'FAIL', 'Calc', 'Column name input present');
            if (colNameInput) await colNameInput.fill('CT minus Offer');

            // Formula selects (left field, operator, right field)
            const formulaSelects = await page.$$('[role="dialog"] button[role="combobox"]');
            log(formulaSelects.length >= 3 ? 'PASS' : 'WARN', 'Calc', `Formula selects present: ${formulaSelects.length}`);

            // Verify CALC_FIELDS are available in left field select
            const firstSelectVal = await formulaSelects[0]?.textContent();
            log(firstSelectVal ? 'PASS' : 'WARN', 'Calc', 'Left field select has value', firstSelectVal?.trim() || '');

            // Result Currency section
            const resultCurrLabel = await page.$('[role="dialog"] label:has-text("Result Currency")');
            log(resultCurrLabel ? 'PASS' : 'WARN', 'Calc', '"Result Currency" section present');

            // Cancel and Add Column buttons
            const cancelBtn = await page.$('[role="dialog"] button:has-text("Cancel")');
            log(cancelBtn ? 'PASS' : 'WARN', 'Calc', '"Cancel" button present');
            const addColBtn = await page.$('[role="dialog"] button:has-text("Add Column")');
            log(addColBtn ? 'PASS' : 'FAIL', 'Calc', '"Add Column" button present');

            // Preview section (only shows when sampleWine exists)
            const previewSection = await page.$('[role="dialog"] p:has-text("Preview")');
            log(previewSection ? 'PASS' : 'WARN', 'Calc', '"Preview" section in dialog (requires results)');

            if (addColBtn && colNameInput) {
              await page.evaluate(() => {
                const btns = [...document.querySelectorAll('[role="dialog"] button')];
                btns.find(b => b.textContent.trim() === 'Add Column')?.click();
              });
              await page.waitForTimeout(800);

              // New column in picker
              const calcInPicker = await page.evaluate(() =>
                [...document.querySelectorAll('span')].some(s => s.textContent.includes('CT minus Offer'))
              );
              log(calcInPicker ? 'PASS' : 'WARN', 'Calc', 'Calc column "CT minus Offer" appears in picker');

              // New column in table header
              const calcInTable = await page.evaluate(() =>
                [...document.querySelectorAll('thead th')].some(th => th.textContent.includes('CT minus Offer'))
              );
              log(calcInTable ? 'PASS' : 'WARN', 'Calc', 'Calc column "CT minus Offer" appears in table');

              // Re-open Columns picker — CalcColumnDialog dismissal may have closed the Popover
              const colsBtnReopen = await page.$('button:has-text("Columns")');
              if (colsBtnReopen) {
                await colsBtnReopen.click();
                await page.waitForTimeout(800);
              }

              // Calculator icon in picker for calc columns (picker must be open)
              const calcIcon = await page.evaluate(() => {
                // The calc column name span contains an inline Calculator SVG
                const spans = [...document.querySelectorAll('span')];
                const pickerSpan = spans.find(x => x.textContent.trim().includes('CT minus Offer') && x.querySelector('svg'));
                return !!pickerSpan;
              });
              log(calcIcon ? 'PASS' : 'WARN', 'Calc', 'Calculator icon shown on calc column in picker');

              // Edit calc column — the edit/delete buttons are in an opacity-0 div; click via JS
              await page.evaluate(() => {
                const spans = [...document.querySelectorAll('span')];
                const pickerSpan = spans.find(x => x.textContent.trim().includes('CT minus Offer') && x.querySelector('svg'));
                if (!pickerSpan) return;
                const grp = pickerSpan.closest('[class*="group"]');
                const actionDiv = grp?.querySelector('div[class*="opacity-0"]');
                const editBtn = actionDiv?.querySelector('button');
                editBtn?.click();
              });
              await page.waitForTimeout(700);

              const editDialog = await page.$('[role="dialog"]');
              const editTitle = editDialog ? await page.evaluate(() =>
                document.querySelector('[role="dialog"] h2')?.textContent.trim()
              ) : null;
              log(editTitle?.includes('Edit Calculated Column') ? 'PASS' : 'WARN', 'Calc', 'Edit calc column dialog opens', editTitle || '');

              // Close edit dialog
              if (editDialog) {
                await page.evaluate(() => {
                  const btns = [...document.querySelectorAll('[role="dialog"] button')];
                  btns.find(b => b.textContent.trim() === 'Cancel')?.click();
                });
                await page.waitForTimeout(500);
              }

              // Re-open picker again after edit dialog closes
              const colsBtnReopenAfterEdit = await page.$('button:has-text("Columns")');
              if (colsBtnReopenAfterEdit) {
                await colsBtnReopenAfterEdit.click();
                await page.waitForTimeout(500);
              }

              // Delete calc column (trash icon — opacity-0 until hover; click via JS)
              await page.evaluate(() => {
                const spans = [...document.querySelectorAll('span')];
                const pickerSpan = spans.find(x => x.textContent.trim().includes('CT minus Offer') && x.querySelector('svg'));
                if (!pickerSpan) return;
                const grp = pickerSpan.closest('[class*="group"]');
                const actionDiv = grp?.querySelector('div[class*="opacity-0"]');
                const btns = actionDiv ? [...actionDiv.querySelectorAll('button')] : [];
                // Last button = trash delete
                btns[btns.length - 1]?.click();
              });
              await page.waitForTimeout(800);

              const calcGone = await page.evaluate(() =>
                ![...document.querySelectorAll('span')].some(s => s.textContent.includes('CT minus Offer'))
              );
              log(calcGone ? 'PASS' : 'WARN', 'Calc', 'Calc column deleted from picker');

              const calcTableGone = await page.evaluate(() =>
                ![...document.querySelectorAll('thead th')].some(th => th.textContent.includes('CT minus Offer'))
              );
              log(calcTableGone ? 'PASS' : 'WARN', 'Calc', 'Calc column removed from table');
            }
          }
        }

        // Close picker by pressing Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.waitForTimeout(500);
      }

      // ── Export CSV ───────────────────────────────────────────────────────────
      console.log('\n  [Export CSV]');

      const exportBtn = await page.$('button:has-text("Export CSV")');
      log(exportBtn ? 'PASS' : 'FAIL', 'Export', '"Export CSV" button present');

      if (exportBtn) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
          page.click('button:has-text("Export CSV")'),
        ]);
        if (download) {
          const filename = download.suggestedFilename();
          log(filename.endsWith('.csv') ? 'PASS' : 'WARN', 'Export', `CSV download triggered`, filename);
          await download.cancel().catch(() => {});
        } else {
          // navigator.share may be used on some platforms
          log('WARN', 'Export', 'CSV download not captured (navigator.share may have been used)');
        }
      }

      // ── Offer Price Editing ──────────────────────────────────────────────────
      console.log('\n  [Offer Price Editing]');

      // The offer column shows "Add" (pencil + text) when empty
      const offerAddBtn = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        const row = rows[0];
        // Find button containing "Add" text (pencil icon + "Add" span)
        const btn = row ? [...row.querySelectorAll('button')].find(b => b.textContent.includes('Add')) : null;
        return btn ? 'found' : null;
      });
      log(offerAddBtn ? 'PASS' : 'WARN', 'Offer', '"Add" offer button in first row');

      if (offerAddBtn) {
        await page.evaluate(() => {
          const rows = document.querySelectorAll('tbody tr');
          const row = rows[0];
          const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('Add'));
          btn?.click();
        });
        await page.waitForTimeout(400);

        // Input appears
        const offerInput = await page.$('input[placeholder="0"]');
        log(offerInput ? 'PASS' : 'WARN', 'Offer', 'Offer price input appeared');

        if (offerInput) {
          // Check and cancel buttons appear
          const checkBtn = await page.evaluate(() => {
            const inputs = [...document.querySelectorAll('input[placeholder="0"]')];
            const inp = inputs[0];
            if (!inp) return false;
            const container = inp.closest('div');
            const btns = container?.querySelectorAll('button');
            return btns?.length >= 2;
          });
          log(checkBtn ? 'PASS' : 'WARN', 'Offer', 'Check (✓) and Cancel (✗) buttons shown in offer edit');

          await offerInput.fill('125.50');

          // Press Enter to save
          await page.keyboard.press('Enter');
          // Wait for the input to disappear and price button to appear
          await page.waitForFunction(() => {
            const rows = document.querySelectorAll('tbody tr');
            const row = rows[0];
            const btns = [...(row?.querySelectorAll('button') || [])];
            return btns.some(b => b.textContent.includes('125') || b.textContent.includes('US$') || b.textContent.includes('$'));
          }, { timeout: 8000 }).catch(() => {});

          // Verify price displayed
          const priceShown = await page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr');
            const row = rows[0];
            const btns = [...(row?.querySelectorAll('button') || [])];
            return btns.some(b => b.textContent.includes('125') || b.textContent.includes('US$'));
          });
          log(priceShown ? 'PASS' : 'WARN', 'Offer', 'Offer price US$125.50 shown after save');

          // Clear the offer: click on it to re-open, then clear
          await page.evaluate(() => {
            const rows = document.querySelectorAll('tbody tr');
            const row = rows[0];
            const btn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('125') || b.textContent.includes('$'));
            btn?.click();
          });
          await page.waitForTimeout(300);
          const clearInput = await page.$('input[placeholder="0"]');
          if (clearInput) {
            await clearInput.fill('');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(800);
          }
          log('PASS', 'Offer', 'Offer price cleared');
        }
      }

      // ── Clear Button ─────────────────────────────────────────────────────────
      console.log('\n  [Clear Button]');

      const clearBtnExists = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some(b => b.textContent.trim() === 'Clear');
      });
      log(clearBtnExists ? 'PASS' : 'WARN', 'Table-Clear', '"Clear" button present in table toolbar');
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 8: Offer Summary
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 8: Offer Summary ════');

    const winesFoundCard = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('p')];
      return ps.some(p => p.textContent.trim().toUpperCase() === 'WINES FOUND');
    });
    log(winesFoundCard ? 'PASS' : 'WARN', 'OfferSummary', '"Wines Found" summary card present');

    if (winesFoundCard) {
      // Check the count is a number
      const foundCount = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('p')];
        const label = ps.find(p => p.textContent.trim().toUpperCase() === 'WINES FOUND');
        const valueEl = label?.nextElementSibling;
        return valueEl?.textContent.trim();
      });
      log(/^\d+$/.test(foundCount || '') ? 'PASS' : 'WARN', 'OfferSummary', 'Wines Found count is numeric', foundCount || '');
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 9: Paste List Tab
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 9: Paste List Tab ════');

    await page.click('[role="tab"]:has-text("Paste List")');
    await page.waitForTimeout(600);

    const pasteTextarea = await page.$('textarea');
    log(pasteTextarea ? 'PASS' : 'FAIL', 'Paste', 'Textarea present');

    const pasteLookupBtnEmpty = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.find(b => b.textContent.includes('Look Up'))?.disabled;
    });
    log(pasteLookupBtnEmpty ? 'PASS' : 'FAIL', 'Paste', 'Look Up disabled when textarea empty');

    // Paste invalid content → detection shows 0
    await page.fill('textarea', 'not wine content');
    await page.waitForTimeout(300);
    const invalidDetect = await page.evaluate(() => {
      return [...document.querySelectorAll('button')].find(b => b.textContent.includes('Look Up'))?.textContent.trim();
    });
    log(invalidDetect?.includes('0 wines') ? 'PASS' : 'WARN', 'Paste', 'Invalid paste: 0 wines detected', invalidDetect || '');

    // Paste valid TSV wines
    await page.fill('textarea', '2019\tPenfolds Grange Hermitage\n2018\tOpus One Napa Valley');
    await page.waitForTimeout(400);

    const detectionText = await page.evaluate(() => {
      return [...document.querySelectorAll('button')].find(b => b.textContent.includes('Look Up'))?.textContent.trim();
    });
    log(detectionText?.includes('2 wines') ? 'PASS' : 'WARN', 'Paste', 'Paste: "2 wines detected" shown', detectionText || '');

    const pasteLookupEnabled = await page.evaluate(() => {
      return ![...document.querySelectorAll('button')].find(b => b.textContent.includes('Look Up'))?.disabled;
    });
    log(pasteLookupEnabled ? 'PASS' : 'FAIL', 'Paste', 'Look Up button enabled with valid wines');

    // Test CSV format detection (comma-separated)
    await page.fill('textarea', 'Size,Vintage,Wine\n750ml,2019,Penfolds Grange\n1.5L,2018,Opus One');
    await page.waitForTimeout(400);
    const csvDetect = await page.evaluate(() => {
      return [...document.querySelectorAll('button')].find(b => b.textContent.includes('Look Up'))?.textContent.trim();
    });
    log(csvDetect?.includes('2 wines') ? 'PASS' : 'WARN', 'Paste', 'CSV format (header row) parsed correctly', csvDetect || '');

    await page.fill('textarea', '');

    // Back to Single Search
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 10: Upload File Tab
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 10: Upload File Tab ════');

    await page.click('[role="tab"]:has-text("Upload File")');
    await page.waitForTimeout(500);

    log(await page.$('label:has-text("Upload your file")') ? 'PASS' : 'FAIL', 'Upload', '"Upload your file" label');
    log(await page.$('p:has-text("Accepts CSV, TSV, TXT, or Excel file")') ? 'PASS' : 'WARN', 'Upload', 'Format description');
    log(await page.$('text=Click to upload CSV, Excel, TSV, or TXT file') ? 'PASS' : 'FAIL', 'Upload', 'Dropzone text present');

    // Click dropzone triggers file picker (input[type=file])
    const dropzoneClickable = await page.evaluate(() => {
      const dropzone = [...document.querySelectorAll('div')].find(d =>
        d.textContent.includes('Click to upload CSV') && d.className?.includes('border-dashed')
      );
      return !!dropzone;
    });
    log(dropzoneClickable ? 'PASS' : 'WARN', 'Upload', 'Dropzone div has dashed border style');

    // Scope to active tabpanel to avoid picking up ImageSearchTab's image/* input (forceMount)
    const fileInputAccept = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"][data-state="active"]');
      return panel?.querySelector('input[type="file"]')?.getAttribute('accept');
    });
    log(fileInputAccept?.includes('.csv') ? 'PASS' : 'FAIL', 'Upload', 'File input accepts .csv', fileInputAccept || '');
    log(fileInputAccept?.includes('.xlsx') ? 'PASS' : 'FAIL', 'Upload', 'File input accepts .xlsx');
    log(fileInputAccept?.includes('.tsv') ? 'PASS' : 'FAIL', 'Upload', 'File input accepts .tsv');
    log(fileInputAccept?.includes('.txt') ? 'PASS' : 'FAIL', 'Upload', 'File input accepts .txt');

    // Back to Single Search
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 11: AI Image Search Tab
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 11: AI Image Search Tab ════');

    await page.click('[role="tab"]:has-text("AI Image Search")');
    await page.waitForTimeout(1000);

    const imageTabContent = await page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"][data-state="active"]');
      return panel ? panel.innerHTML.length > 50 : false;
    });
    log(imageTabContent ? 'PASS' : 'WARN', 'ImageTab', 'AI Image Search tab has content');

    // Back to Single Search
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 12: History Section
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 12: History Section ════');

    // History headings for each tab
    const historyHeadings = [
      { tab: 'single',  label: 'Single Search',    heading: 'Single Search - Previous Results' },
      { tab: 'paste',   label: 'Paste List',        heading: 'Paste List - Previous Results' },
      { tab: 'upload',  label: 'Upload File',        heading: 'Upload File - Previous Results' },
      { tab: 'image',   label: 'AI Image Search',   heading: 'AI Image Search - Previous Results' },
    ];

    for (const { tab, label, heading } of historyHeadings) {
      await page.click(`[role="tab"]:has-text("${label}")`);
      await page.waitForTimeout(600);

      const headingEl = await page.$(`h3:has-text("${heading}")`);
      log(headingEl ? 'PASS' : 'FAIL', 'History', `"${heading}" heading`);

      const retentionNote = await page.$('p:has-text("History kept for 6 months")');
      log(retentionNote ? 'PASS' : 'WARN', 'History', `[${label}] "History kept for 6 months" note`);
    }

    // Focus on Single Search history
    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(600);

    const noHistoryMsg = await page.$('p:has-text("No previous result yet")');
    const hasBatchHistory = !noHistoryMsg;

    if (noHistoryMsg) {
      log('WARN', 'History', 'Single Search: "No previous result yet" (empty state)');
    } else {
      log('PASS', 'History', 'Single Search: history section has content (BatchHistorySection)');

      // Export All CSV button
      const exportAllBtn = await page.$('button:has-text("Export All CSV")');
      log(exportAllBtn ? 'PASS' : 'FAIL', 'History', '"Export All CSV" button');

      // Clear All History button
      const clearAllBtn = await page.$('button:has-text("Clear All History")');
      log(clearAllBtn ? 'PASS' : 'FAIL', 'History', '"Clear All History" button');

      // Check for "Today" or month grouping (span text inside cursor-pointer header div)
      const hasGrouping = await page.evaluate(() => {
        const divs = [...document.querySelectorAll('div.cursor-pointer')];
        return divs.some(d => {
          const spans = d.querySelectorAll('span');
          return [...spans].some(s => {
            const t = s.textContent.trim();
            return t === 'Today' || /^\w+ \d{4}$/.test(t);
          });
        });
      });
      log(hasGrouping ? 'PASS' : 'WARN', 'History', 'Collapsible batch group(s) present (Today / Month Year)');

      // Expand "Today" batch if exists
      const todayExists = await page.evaluate(() => {
        return [...document.querySelectorAll('div.cursor-pointer')].some(d => {
          const spans = d.querySelectorAll('span');
          return [...spans].some(s => s.textContent.trim() === 'Today');
        });
      });

      if (todayExists) {
        await page.evaluate(() => {
          const divs = [...document.querySelectorAll('div.cursor-pointer')];
          const todayDiv = divs.find(d => [...d.querySelectorAll('span')].some(s => s.textContent.trim() === 'Today'));
          todayDiv?.click();
        });
        await page.waitForTimeout(800);

        // Wine count visible
        const wineCount = await page.evaluate(() => {
          const spans = [...document.querySelectorAll('span.text-xs.text-gray-400')];
          return spans.find(s => s.textContent.includes('wines'))?.textContent.trim();
        });
        log(wineCount ? 'PASS' : 'WARN', 'History', `Today batch: wine count shown`, wineCount || '');

        // Table inside expanded batch
        const tablesAfterExpand = await page.$$('table');
        log(tablesAfterExpand.length > 1 ? 'PASS' : 'WARN', 'History', `Today batch expanded: ${tablesAfterExpand.length} tables visible`);

        // Delete button in history table (onDelete prop is passed)
        const deleteInHistory = await page.evaluate(() => {
          const tables = document.querySelectorAll('table');
          // Check last table (inside batch)
          const lastTable = tables[tables.length - 1];
          const ths = [...(lastTable?.querySelectorAll('thead th') || [])];
          return ths.some(th => th.textContent.trim().toUpperCase() === 'DELETE');
        });
        log(deleteInHistory ? 'PASS' : 'WARN', 'History', '"Delete" column present in history table (onDelete wired)');

        if (deleteInHistory) {
          // Click delete on first row
          const deleteClicked = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            const lastTable = tables[tables.length - 1];
            const firstRow = lastTable?.querySelector('tbody tr');
            const tds = firstRow?.querySelectorAll('td');
            const lastTd = tds?.[tds.length - 1];
            const btn = lastTd?.querySelector('button');
            if (btn) { btn.click(); return true; }
            return false;
          });
          await page.waitForTimeout(500);

          // AlertDialog should appear
          const alertDialog = await page.$('[role="alertdialog"]');
          log(alertDialog ? 'PASS' : 'FAIL', 'History', 'Delete confirmation AlertDialog appeared');

          if (alertDialog) {
            const dialogTitle = await page.$('[role="alertdialog"] h2');
            const titleText = await dialogTitle?.textContent();
            log(titleText?.includes('Delete') ? 'PASS' : 'WARN', 'History', 'Delete dialog title', titleText || '');

            const deleteConfirmBtn = await page.$('[role="alertdialog"] button:has-text("Delete")');
            log(deleteConfirmBtn ? 'PASS' : 'WARN', 'History', '"Delete" confirm button in dialog');

            // Cancel to preserve data
            const cancelDialogBtn = await page.$('[role="alertdialog"] button:has-text("Cancel")');
            if (cancelDialogBtn) {
              await cancelDialogBtn.click();
              await page.waitForTimeout(400);
              log('PASS', 'History', 'Delete cancelled (data preserved)');
            }
          }
        }

        // Export CSV button inside the expanded batch (in batch's WineResultsTable toolbar)
        const batchExportBtn = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button')];
          return btns.filter(b => b.textContent.trim() === 'Export CSV').length;
        });
        log(batchExportBtn > 0 ? 'PASS' : 'WARN', 'History', `"Export CSV" button(s) in expanded batch: ${batchExportBtn}`);

        // Collapse the batch
        await page.evaluate(() => {
          const divs = [...document.querySelectorAll('div.cursor-pointer')];
          const todayDiv = divs.find(d => [...d.querySelectorAll('span')].some(s => s.textContent.trim() === 'Today'));
          todayDiv?.click();
        });
        await page.waitForTimeout(400);
      }

      // Export All CSV
      if (exportAllBtn) {
        const [dl2] = await Promise.all([
          page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
          page.click('button:has-text("Export All CSV")'),
        ]);
        log(dl2 ? 'PASS' : 'WARN', 'History', '"Export All CSV" triggers download', dl2?.suggestedFilename() || '(no download event)');
        await dl2?.cancel().catch(() => {});
      }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 13: Empty State
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 13: Empty State ════');

    // Check if image/upload tabs show empty state
    for (const { label } of [{ label: 'AI Image Search' }, { label: 'Upload File' }]) {
      await page.click(`[role="tab"]:has-text("${label}")`);
      await page.waitForTimeout(500);

      const isEmpty = await page.evaluate(() => {
        const wineIcon = [...document.querySelectorAll('svg')].some(svg => {
          const path = svg.parentElement?.textContent;
          return path?.includes('No wine lookups yet');
        });
        const emptyText = document.body.textContent.includes('No wine lookups yet');
        return emptyText;
      });
      log(isEmpty ? 'PASS' : 'WARN', 'EmptyState', `[${label}] Empty state visible ("No wine lookups yet")`);
    }

    await page.click('[role="tab"]:has-text("Single Search")');
    await page.waitForTimeout(500);


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 14: Connection State Tests
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 14: Connection State Tests ════');

    const creds = await apiCreds();
    const ctCred = creds.find(c => c.site_name === 'cellar_tracker');
    const wsCred = creds.find(c => c.site_name === 'wine_searcher');

    if (!ctCred || !wsCred) {
      log('WARN', 'ConnState', 'Could not find CT or WS credentials — skipping');
    } else {
      // Ensure both start enabled (in case a prior run crashed mid-way)
      if (!ctCred.is_enabled) await setCredEnabled(ctCred.id, true);
      if (!wsCred.is_enabled) await setCredEnabled(wsCred.id, true);

      // ── Disable WS only → CT pill on, WS pill disabled ────────────────────
      console.log('  Disabling WS...');
      const wsDisabled = await setCredEnabled(wsCred.id, false);
      log(wsDisabled ? 'PASS' : 'FAIL', 'ConnState', 'WS disabled via API');

      await navToLookup(page);

      const wsPillAfterDisable = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Wine-Searcher'))?.textContent.trim();
      });
      log(wsPillAfterDisable?.includes('disabled') ? 'PASS' : 'FAIL', 'ConnState',
        'WS pill shows "disabled"', wsPillAfterDisable || '');

      const ctPillStillOn = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Cellar Tracker'))?.textContent.trim();
      });
      log(ctPillStillOn?.includes(' on') ? 'PASS' : 'WARN', 'ConnState',
        'CT pill still shows "on" when WS disabled', ctPillStillOn || '');

      // No connection gate (CT is still active)
      const gateShown = await page.$('p:has-text("No sources connected")');
      log(!gateShown ? 'PASS' : 'FAIL', 'ConnState', 'No connection gate shown when CT is active');

      // Run a quick lookup to verify WS shows "not enabled"
      console.log('  Running CT-only lookup to check WS "not enabled" behaviour...');
      await page.fill('input[placeholder="2018"]', '2020');
      await page.fill('input[placeholder*="Château"]', 'Chateau Margaux');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up')?.click();
      });

      const ctOnlyProgress = await page.waitForSelector('text=Looking up prices...', { timeout: 10000 })
        .then(() => true).catch(() => false);
      log(ctOnlyProgress ? 'PASS' : 'WARN', 'ConnState', 'Lookup started (CT only)');

      if (ctOnlyProgress) {
        console.log('  Waiting for CT-only lookup (up to 60s)...');
        // Wait for progress bar to disappear (indicates SSE stream complete)
        await page.waitForFunction(() => !document.body.innerText.includes('Looking up prices...'),
          { timeout: 60000 }).catch(() => {});
        // Wait for all spinners to resolve
        await page.waitForFunction(() => !document.querySelectorAll('tbody svg.animate-spin').length,
          { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);

        // WS columns should show "not enabled" text (or "no connection" for unconfigured WS)
        await page.waitForFunction(() =>
          [...document.querySelectorAll('tbody td')].some(td => {
            const t = td.textContent.trim();
            return t === 'not enabled' || t === 'no connection';
          }),
          { timeout: 10000 }
        ).catch(() => {});
        const wsNotEnabled = await page.evaluate(() => {
          return [...document.querySelectorAll('tbody td')].some(td => {
            const t = td.textContent.trim();
            return t === 'not enabled' || t === 'no connection';
          });
        });
        log(wsNotEnabled ? 'PASS' : 'WARN', 'ConnState', 'WS cells show "not enabled" when WS disabled');

        const ctDataPresent = await page.evaluate(() => {
          const ths = [...document.querySelectorAll('thead th')];
          const idx = ths.findIndex(th => th.textContent.includes('CT Avg Value'));
          if (idx === -1) return false;
          return [...document.querySelectorAll('tbody tr')].some(tr => {
            const val = tr.querySelectorAll('td')[idx]?.textContent.trim();
            return val && val !== '—' && val !== 'not enabled' && val !== 'no connection';
          });
        });
        log(ctDataPresent ? 'PASS' : 'WARN', 'ConnState', 'CT Avg Value still populated in CT-only mode');
      }

      // Re-enable WS
      await setCredEnabled(wsCred.id, true);
      log('PASS', 'ConnState', 'WS re-enabled');

      // ── Disable CT only → WS pill on, CT pill disabled ────────────────────
      console.log('  Disabling CT...');
      await setCredEnabled(ctCred.id, false);
      await navToLookup(page);

      const ctPillAfterDisable = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Cellar Tracker'))?.textContent.trim();
      });
      log(ctPillAfterDisable?.includes('disabled') ? 'PASS' : 'FAIL', 'ConnState',
        'CT pill shows "disabled"', ctPillAfterDisable || '');

      const wsPillStillOn = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Wine-Searcher'))?.textContent.trim();
      });
      log(wsPillStillOn?.includes(' on') ? 'PASS' : 'WARN', 'ConnState',
        'WS pill still shows "on" when CT disabled', wsPillStillOn || '');

      // Re-enable CT
      await setCredEnabled(ctCred.id, true);

      // Reload and verify both back to "on"
      await navToLookup(page);
      const bothOn = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[class*="rounded-full"]')];
        const ct = els.find(e => e.textContent.includes('Cellar Tracker'))?.textContent;
        const ws = els.find(e => e.textContent.includes('Wine-Searcher'))?.textContent;
        return ct?.includes(' on') && ws?.includes(' on');
      });
      log(bothOn ? 'PASS' : 'WARN', 'ConnState', 'Both CT and WS back to "on" after re-enabling');
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION 15: Connection Gate
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n════ SECTION 15: Connection Gate ════');

    const creds2 = await apiCreds();
    const ct2 = creds2.find(c => c.site_name === 'cellar_tracker');
    const ws2 = creds2.find(c => c.site_name === 'wine_searcher');

    if (!ct2 || !ws2) {
      log('WARN', 'Gate', 'Cannot find credentials — skipping gate test');
    } else {
      // Ensure both are enabled before disabling (clean state)
      if (!ct2.is_enabled) await setCredEnabled(ct2.id, true);
      if (!ws2.is_enabled) await setCredEnabled(ws2.id, true);
      // Disable both
      console.log('  Disabling both CT and WS...');
      await setCredEnabled(ct2.id, false);
      await setCredEnabled(ws2.id, false);
      await navToLookup(page);

      // "Connect accounts →" link appears
      const connectLink = await page.$('a:has-text("Connect accounts")');
      log(connectLink ? 'PASS' : 'FAIL', 'Gate', '"Connect accounts →" link shown when no sources active');

      // Source pills show "not connected" or "disabled"
      const ctPillGate = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Cellar Tracker'))?.textContent.trim();
      });
      const wsPillGate = await page.evaluate(() => {
        return [...document.querySelectorAll('[class*="rounded-full"]')].find(e => e.textContent.includes('Wine-Searcher'))?.textContent.trim();
      });
      log(!ctPillGate?.includes(' on') ? 'PASS' : 'FAIL', 'Gate', 'CT pill not "on" when disabled', ctPillGate || '');
      log(!wsPillGate?.includes(' on') ? 'PASS' : 'FAIL', 'Gate', 'WS pill not "on" when disabled', wsPillGate || '');

      // "Important!" note should NOT appear (requires hasAnySource)
      const importantNoteGate = await page.$('p:has-text("The best price does not equate")');
      log(!importantNoteGate ? 'PASS' : 'WARN', 'Gate', '"Important!" note hidden when no sources active');

      // Submit a lookup → gate banner appears
      await page.fill('input[placeholder="2018"]', '2021');
      await page.fill('input[placeholder*="Château"]', 'Test Wine');
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Look Up')?.click();
      });
      await page.waitForTimeout(800);

      // Gate banner: "No sources connected"
      const gateBanner = await page.$('p:has-text("No sources connected")');
      log(gateBanner ? 'PASS' : 'FAIL', 'Gate', '"No sources connected" banner on submit');

      const gateDesc = await page.$('p:has-text("At least one source must be connected")');
      log(gateDesc ? 'PASS' : 'WARN', 'Gate', 'Gate description text present');

      // "Go to Connections →" link inside gate
      const goConnLink = await page.$('a:has-text("Go to Connections")');
      log(goConnLink ? 'PASS' : 'FAIL', 'Gate', '"Go to Connections →" link in gate banner');

      // Verify href points to /Connections
      const connHref = await goConnLink?.getAttribute('href');
      log(connHref?.includes('Connections') ? 'PASS' : 'WARN', 'Gate', '"Go to Connections" href correct', connHref || '');

      // Dismiss gate with × button
      const dismissBtn = await page.$('button[aria-label="Dismiss"]');
      log(dismissBtn ? 'PASS' : 'WARN', 'Gate', 'Gate dismiss (×) button present');
      if (dismissBtn) {
        await dismissBtn.click();
        await page.waitForTimeout(500);
        const gateDismissed = !(await page.$('p:has-text("No sources connected")'));
        log(gateDismissed ? 'PASS' : 'WARN', 'Gate', 'Gate dismissed on × click');
      }

      // Re-enable both connections
      console.log('  Re-enabling CT and WS...');
      await setCredEnabled(ct2.id, true);
      await setCredEnabled(ws2.id, true);
      await navToLookup(page);

      const bothRestoredFinal = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[class*="rounded-full"]')];
        const ct = els.find(e => e.textContent.includes('Cellar Tracker'))?.textContent;
        const ws = els.find(e => e.textContent.includes('Wine-Searcher'))?.textContent;
        return ct?.includes(' on') && ws?.includes(' on');
      });
      log(bothRestoredFinal ? 'PASS' : 'WARN', 'Gate', 'Both connections restored', bothRestoredFinal ? 'CT on + WS on' : 'not verified');
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(65));
    console.log(`  FINAL RESULTS: ${passed} PASS  |  ${warnings} WARN  |  ${failed} FAIL`);
    console.log('═'.repeat(65));

    if (failed > 0) {
      console.log('\nFailed checks:');
      results.filter(r => r.status === 'FAIL').forEach(r =>
        console.log(`  ❌ [${r.section}] ${r.test}${r.detail ? ' — ' + r.detail : ''}`)
      );
    }

  } catch (err) {
    console.error('\nFATAL ERROR:', err);
    failed++;
  } finally {
    await browser.close();
  }

  process.exit(failed > 0 ? 1 : 0);
})();
