/**
 * Take guide screenshots of the new UI for the guide modals.
 * Saves PNGs to src/assets/guide/
 */
import { chromium } from 'playwright';
import jwt from '../node_modules/jsonwebtoken/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dir      = dirname(__filename);
const ASSETS_DIR = join(__dir, '../src/assets/guide');

const BASE       = 'http://localhost:5173';
const JWT_SECRET = 'devsecret_replace_me';
const USER_ID    = 'cd527c9b-44cc-4b84-9948-91350c8af6a4';
const EMAIL      = 'zanrow.co@gmail.com';

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

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await injectAuth(page);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });

  // Light mode, 1280x800
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // ── Connections page screenshots ───────────────────────────────────────────
  console.log('Navigating to Connections page...');
  await goto(page, '/Connections');

  // conn-full.png — full page (before connecting)
  await page.screenshot({ path: `${ASSETS_DIR}/conn-full.png`, fullPage: false });
  console.log('✅ conn-full.png');

  // conn-data-cards.png — just the cards area (not connected)
  const cardsSection = page.locator('.grid.grid-cols-1');
  if (await cardsSection.count() > 0) {
    await cardsSection.first().screenshot({ path: `${ASSETS_DIR}/conn-data-cards.png` });
    console.log('✅ conn-data-cards.png');
  } else {
    await page.screenshot({ path: `${ASSETS_DIR}/conn-data-cards.png`, clip: { x: 0, y: 150, width: 1280, height: 500 } });
    console.log('✅ conn-data-cards.png (fallback)');
  }

  // ── Connections page — connected state ────────────────────────────────────
  // We'll screenshot at a wider viewport to show the page normally
  // conn-connected.png — connected state (if credentials exist, else just the page)
  await page.screenshot({ path: `${ASSETS_DIR}/conn-connected.png`, fullPage: false });
  console.log('✅ conn-connected.png');

  // conn-connected-cards.png — same but focused on cards
  await page.screenshot({ path: `${ASSETS_DIR}/conn-connected-cards.png`, clip: { x: 0, y: 150, width: 1280, height: 520 } });
  console.log('✅ conn-connected-cards.png');

  // ── Lookup page screenshots ────────────────────────────────────────────────
  console.log('\nNavigating to Lookup page...');
  await goto(page, '/Lookup');

  // lookup-full.png — full lookup page
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-full.png`, fullPage: false });
  console.log('✅ lookup-full.png');

  // lookup-server-mode.png — show the header with source pills / lookup mechanism info
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-server-mode.png`, clip: { x: 0, y: 0, width: 1280, height: 300 } });
  console.log('✅ lookup-server-mode.png');

  // lookup-paste.png — paste tab
  const pasteTab = page.locator('[role="tab"]:has-text("Paste List")');
  if (await pasteTab.count() > 0) {
    await pasteTab.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-paste.png`, clip: { x: 0, y: 60, width: 1280, height: 560 } });
  console.log('✅ lookup-paste.png');

  // Back to single search
  const singleTab = page.locator('[role="tab"]:has-text("Single Search")');
  if (await singleTab.count() > 0) {
    await singleTab.click();
    await page.waitForTimeout(500);
  }

  // lookup-input-area.png — the input form area
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-input-area.png`, clip: { x: 0, y: 60, width: 1280, height: 400 } });
  console.log('✅ lookup-input-area.png');

  // lookup-results-table.png — if results exist, capture the table area
  const resultsHeading = page.locator('h2:has-text("Latest Results")');
  if (await resultsHeading.count() > 0) {
    const resultsBox = await resultsHeading.first().boundingBox();
    if (resultsBox) {
      await page.screenshot({
        path: `${ASSETS_DIR}/lookup-results-table.png`,
        clip: { x: 0, y: Math.max(0, resultsBox.y - 20), width: 1280, height: 460 }
      });
      console.log('✅ lookup-results-table.png (with results)');
    }
  } else {
    // No results yet — screenshot the full page as fallback
    await page.screenshot({ path: `${ASSETS_DIR}/lookup-results-table.png`, fullPage: false });
    console.log('✅ lookup-results-table.png (fallback - no results)');
  }

  // lookup-header.png — just the page header
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-header.png`, clip: { x: 0, y: 0, width: 1280, height: 160 } });
  console.log('✅ lookup-header.png');

  // lookup-single.png — the single search tab area
  await page.screenshot({ path: `${ASSETS_DIR}/lookup-single.png`, clip: { x: 0, y: 60, width: 1280, height: 400 } });
  console.log('✅ lookup-single.png');

  await browser.close();
  console.log('\nAll screenshots saved to src/assets/guide/');
})();
