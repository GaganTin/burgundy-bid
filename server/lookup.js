import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Pool } from 'pg';
import path from 'path';

let _sharedPool = null;
function _getPool() {
  if (!_sharedPool) {
    const url = (process.env.DATABASE_URL || '').replace(/^postgresql\+psycopg2:\/\//, 'postgres://');
    _sharedPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  }
  return _sharedPool;
}
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getPlaywrightProxy, encryptCookies, decryptCookies } from './proxy.js';
import { ctLogin, wsLogin, WS_AUTH_SIGNALS } from './scrapers.js';

// Activate all stealth evasions (patches webdriver flag, iframe detection,
// source-url fingerprinting, and more — complements our inline STEALTH_SCRIPT).
chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Base dir for per-user Wine-Searcher browser profiles (PX cookie isolation).
const WS_PROFILES_BASE = path.join(__dirname, '..', '.ws_browser_profiles');
// Fallback single-user profile (legacy / no userId)
const WS_PROFILE_DIR = path.join(WS_PROFILES_BASE, 'default');

// Diagnostics directory for captcha/error screenshots
const DIAG_DIR = path.join(__dirname, 'lookup_diagnostics');
try { fs.mkdirSync(DIAG_DIR, { recursive: true }); } catch (e) {}

/** Infer a 3-letter ISO currency code from a price string prefix. Defaults to 'USD'. */
function inferCurrencyFromPrice(priceStr) {
  if (!priceStr) return 'USD';
  const s = String(priceStr).trim();
  // Multi-char prefixes must come before single-char checks
  if (s.startsWith('EU€'))  return 'EUR';
  if (s.startsWith('GB£'))  return 'GBP';
  if (s.startsWith('JP¥'))  return 'JPY';
  if (s.startsWith('US$'))  return 'USD';
  if (s.startsWith('HK$'))  return 'HKD';
  if (s.startsWith('A$'))   return 'AUD';
  if (s.startsWith('C$'))   return 'CAD';
  if (s.startsWith('S$'))   return 'SGD';
  if (s.startsWith('CHF'))  return 'CHF';
  if (s.startsWith('Fr'))   return 'CHF';
  // Single-char fallbacks (raw scraped data from CT/WS before formatting)
  if (s.startsWith('€'))    return 'EUR';
  if (s.startsWith('£'))    return 'GBP';
  if (s.startsWith('¥'))    return 'JPY';
  if (s.startsWith('$'))    return 'USD';
  // Bare ISO code prefix e.g. "USD 45.00"
  const m = s.match(/^([A-Z]{3})\s/);
  if (m) return m[1];
  return 'USD';
}

// ── Viewport + user-agent rotation ──────────────────────────────────────────
// Windows-only UAs kept to stay consistent with Win32 platform in STEALTH_SCRIPT.
// Index is seeded from userId so the same user always gets the same profile
// (consistent fingerprint), but different users look like different machines.
const _VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
];
const _USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
];

function _profileHash(seed, len) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(31, h) + seed.charCodeAt(i) | 0; }
  return Math.abs(h) % len;
}
function _pickProfile(userId) {
  const seed = userId || 'default';
  return {
    viewport:  _VIEWPORTS[_profileHash(seed,        _VIEWPORTS.length)],
    userAgent: _USER_AGENTS[_profileHash(seed + '_ua', _USER_AGENTS.length)],
  };
}

// ── Global concurrency semaphore ─────────────────────────────────────────────
// Caps simultaneous Playwright sessions. On a 16 GB server, 20 parallel sessions
// clear the queue in under a minute. Override with LOOKUP_CONCURRENCY env var.
const _MAX_CONCURRENT = parseInt(process.env.LOOKUP_CONCURRENCY || '20', 10);
let _activeCount = 0;
const _semWaiters = [];
async function _acquireSem() {
  if (_activeCount < _MAX_CONCURRENT) { _activeCount++; return; }
  await new Promise(r => _semWaiters.push(r));
  _activeCount++;
}
function _releaseSem() {
  _activeCount = Math.max(0, _activeCount - 1);
  if (_semWaiters.length) _semWaiters.shift()();
}

// ── Per-user result cache ─────────────────────────────────────────────────────
// WS prices can shift within minutes → short TTL.
// CT community averages are more stable → longer TTL.
// Session/network errors are NOT cached so the user can retry immediately.
const _wsCache = new Map();
const _ctCache = new Map();
const _WS_TTL = 8  * 60 * 1000; //  8 minutes
const _CT_TTL = 45 * 60 * 1000; // 45 minutes

function _cacheGet(map, uid, key) {
  const e = map.get((uid || 'anon') + ':' + key);
  return (e && Date.now() < e.x) ? e.v : null;
}
function _cacheSet(map, uid, key, val, ttl) {
  map.set((uid || 'anon') + ':' + key, { v: val, x: Date.now() + ttl });
}

// Headless mode: true on Linux servers without a display, or when explicitly set.
// In headless mode: no persistent Chrome profiles (saves disk), no manual captcha popup.
const IS_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === 'true' ||
  (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);

const CT_BASE = 'https://www.cellartracker.com';
const WS_BASE = 'https://www.wine-searcher.com';

const STEALTH_SCRIPT = `(function(){
  // Wrapped in try-catch so each patch is independent — the stealth plugin may
  // have already defined some of these at a lower level; silent failures are fine.
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch(e) {}
  try {
    if (!window.chrome || !window.chrome.runtime) {
      window.chrome = {
        app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
        runtime: { id: undefined, connect: function(){}, sendMessage: function(){}, onMessage: { addListener: function(){} } },
        loadTimes: function(){ return { firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', requestTime: Date.now()/1000, startLoadTime: Date.now()/1000, commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, connectionInfo: 'http/1.1', npnNegotiatedProtocol: 'unknown', wasNpnNegotiated: false, wasFetchedViaSpdy: false }; },
        csi: function(){ return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 }; }
      };
    }
  } catch(e) {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch(e) {}
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); } catch(e) {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); } catch(e) {}
  try { Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }); } catch(e) {}
  try { Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' }); } catch(e) {}
  try {
    const fakePlugins = ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client'].map(function(name) {
      return { name: name, description: '', filename: name.toLowerCase().replace(/ /g,'-'), length: 0, item: function(){return null;}, namedItem: function(){return null;} };
    });
    fakePlugins.length = 3;
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
  } catch(e) {}
  if (window.Permissions && window.Permissions.prototype) {
    var origQuery = window.Permissions.prototype.query;
    window.Permissions.prototype.query = function(p) {
      return p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery.apply(this, arguments);
    };
  }
  try {
    var origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return origGetParam.apply(this, arguments);
    };
    var origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return origGetParam2.apply(this, arguments);
    };
  } catch(e) {}
  try {
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === 'image/png' && this.width > 16 && this.height > 16) {
        var ctx = this.getContext('2d');
        if (ctx) { var px = ctx.getImageData(0,0,1,1); px.data[0]=(px.data[0]+1)%256; ctx.putImageData(px,0,0); }
      }
      return origToDataURL.apply(this, arguments);
    };
  } catch(e) {}
  try { Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }) }); } catch(e) {}
  try { Object.defineProperty(screen, 'colorDepth', { get: () => 24 }); } catch(e) {}
  try { Object.defineProperty(screen, 'pixelDepth', { get: () => 24 }); } catch(e) {}
})();`;

const PX_SIGNALS = ['press & hold', 'px-captcha', 'access to this page has been denied', 'perimeterx', 'px-cloud.net'];

// Sentinel returned by ws_get_wine_data when PX auto-solve fails — caller should
// wipe the WS profile, relaunch the context, and retry the wine lookup once.
const WS_PX_BLOCKED = '__WS_PX_BLOCKED__';

// Sentinel returned by ct_get_wine_data when CT's paywall is detected.
// Once set, all remaining CT lookups in the batch are skipped (paywall is account-wide).
const CT_PAYWALL_ERR = '__CT_PAYWALL__';

const AUCTION_KW = /auction|christie|sotheby|bonham|zachys|acker|hart\s*davis|k&l\s*spirits|skinner\s*aucti/i;

async function _saveDiag(page, tag) {
  try {
    const ts = Date.now();
    await page.screenshot({ path: path.join(DIAG_DIR, `${tag}_${ts}.png`), fullPage: true });
    await fs.promises.writeFile(path.join(DIAG_DIR, `${tag}_${ts}.html`), await page.content(), 'utf8');
  } catch (e) {}
}

// Human-like cubic bezier mouse movement (realistic acceleration curve)
async function _humanMouseMove(page, targetX, targetY) {
  const startX = 300 + Math.random() * 600;
  const startY = 200 + Math.random() * 400;
  const cp1x = startX + (targetX - startX) * 0.3 + (Math.random() - 0.5) * 130;
  const cp1y = startY + (targetY - startY) * 0.3 + (Math.random() - 0.5) * 130;
  const cp2x = startX + (targetX - startX) * 0.7 + (Math.random() - 0.5) * 70;
  const cp2y = startY + (targetY - startY) * 0.7 + (Math.random() - 0.5) * 70;
  const steps = 38 + Math.floor(Math.random() * 22);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    const x = Math.pow(1-e,3)*startX + 3*Math.pow(1-e,2)*e*cp1x + 3*(1-e)*Math.pow(e,2)*cp2x + Math.pow(e,3)*targetX;
    const y = Math.pow(1-e,3)*startY + 3*Math.pow(1-e,2)*e*cp1y + 3*(1-e)*Math.pow(e,2)*cp2y + Math.pow(e,3)*targetY;
    await page.mouse.move(x, y);
    const delay = 6 + Math.sin(Math.PI * t) * 14 + Math.random() * 7;
    await page.waitForTimeout(delay);
  }
}

// Find the PX "Press & Hold" button across all frames (captcha renders in iframe)
async function _findPxButtonLocator(page) {
  // First: look inside all frames for the real iframe-based challenge button
  for (const frame of page.frames()) {
    try {
      const el = frame.getByText('Press & Hold', { exact: true }).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        const b = await el.boundingBox();
        if (b && b.width > 10 && b.height > 10) {
          console.log('[PX] Button in frame ' + frame.url().slice(0, 50) + ' box=' + JSON.stringify(b));
          return { locator: el, box: b, inFrame: frame.url() !== 'about:blank' };
        }
      }
    } catch (e) {}
  }
  // Fallback: main-frame selectors for the error-variant button (div-based, not iframe)
  for (const sel of ['div.px-captcha-error-button', '.px-captcha-error-container div[class*="button"]', '#px-captcha div', '.px-captcha-container div[id*="captcha"]']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        const b = await el.boundingBox();
        if (b && b.width > 10) { console.log('[PX] Error-variant button via ' + sel); return { locator: el, box: b }; }
      }
    } catch (e) {}
  }
  return null;
}

// Solve PerimeterX "press & hold" challenge with behavioral biometric simulation.
// Uses frame-aware locator.hover() so events properly enter the captcha iframe.
async function _solvePxCaptcha(page, maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await page.waitForTimeout(3000 + Math.random() * 4000);

    // Give captcha.js time to fully render the iframe challenge button.
    await page.waitForTimeout(attempt === 0 ? 4000 + Math.random() * 4000 : 3000 + Math.random() * 2000);

    const alreadyClear = await _waitForPxClear(page, 2000).catch(() => false);
    if (alreadyClear) return true;

    const found = await _findPxButtonLocator(page);
    if (!found) {
      console.log('[PX] Hold button not found on attempt ' + attempt);
      await _saveDiag(page, 'px_no_button_attempt_' + attempt);
      continue;
    }

    const { locator, box } = found;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    console.log('[PX] Attempt ' + attempt + ': button center=(' + Math.round(cx) + ',' + Math.round(cy) + ') size=' + Math.round(box.width) + 'x' + Math.round(box.height));

    // Natural pre-hover: move mouse from a random position toward the button area
    await _humanMouseMove(page, cx + (Math.random() - 0.5) * 200, box.y - 80 - Math.random() * 60);
    await page.waitForTimeout(600 + Math.random() * 800);
    // Slow approach to button
    await _humanMouseMove(page, cx + (Math.random() - 0.5) * 40, cy + (Math.random() - 0.5) * 20);
    await page.waitForTimeout(300 + Math.random() * 300);

    // Frame-aware hover: Playwright dispatches events through the frame's coordinate space
    try {
      await locator.hover({ timeout: 5000, force: false });
    } catch (e) {
      console.log('[PX] hover() failed, falling back to coordinate move');
      await page.mouse.move(cx, cy, { steps: 25 });
    }
    await page.waitForTimeout(400 + Math.random() * 400);

    // Press and hold: 8–13s (hold well past 100% fill; PX measures full completion)
    const holdMs = 8000 + Math.random() * 5000;
    console.log('[PX] Holding for ' + Math.round(holdMs) + 'ms...');
    await page.mouse.down();

    // Micro-tremor: ±1.5px, ~8Hz — subtle enough to look human, tight enough to stay on button
    let elapsed = 0;
    let midSnap = false;
    while (elapsed < holdMs) {
      const dx = (Math.random() - 0.5) * 3;
      const dy = (Math.random() - 0.5) * 1.5;
      await page.mouse.move(cx + dx, cy + dy);
      const wait = 90 + Math.random() * 60;
      await page.waitForTimeout(wait);
      elapsed += wait;
      if (!midSnap && elapsed > holdMs / 2) {
        midSnap = true;
        await _saveDiag(page, 'px_mid_hold_attempt_' + attempt);
      }
    }

    await page.mouse.up();
    console.log('[PX] Released. Checking...');

    await page.waitForTimeout(2000);
    const cleared = await _waitForPxClear(page, 10000);
    if (cleared) {
      console.log('[PX] CLEARED on attempt ' + attempt + '!');
      return true;
    }

    console.log('[PX] Not cleared on attempt ' + attempt);
    await _saveDiag(page, 'px_hold_attempt_' + attempt);
  }
  return false;
}

// Wipe Chromium session data to get a fresh PX fingerprint on retry.
function _wipePxProfile(profileDir) {
  const toWipe = [
    path.join(profileDir, 'Default', 'Cookies'),
    path.join(profileDir, 'Default', 'Cookies-journal'),
    path.join(profileDir, 'Default', 'Local Storage'),
    path.join(profileDir, 'Default', 'Session Storage'),
    path.join(profileDir, 'Default', 'IndexedDB'),
    path.join(profileDir, 'Default', 'Cache'),
    path.join(profileDir, 'Default', 'Code Cache'),
    path.join(profileDir, 'Default', 'Network'),
  ];
  let wiped = 0;
  for (const p of toWipe) {
    try { fs.rmSync(p, { recursive: true, force: true }); wiped++; } catch (e) {}
  }
  console.log(`[PX] Wiped ${wiped} profile paths in ${profileDir}`);
}

// Remove stale Chrome profile lock files that cause launchPersistentContext to crash.
function _unlockProfile(profileDir) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']) {
    try { fs.unlinkSync(path.join(profileDir, name)); } catch (e) {}
  }
}

// Open the WS location modal, check if the worldwide button has the "active"
// class, and if not click it and save. Verifies active class after saving.
// Returns true if a change was made.
async function _ensureWsWorldwide(page, force = false) {
  try {
    // ── Detect current location via nav bar ───────────────────────────────────
    // Nav label "ALL" + icon-regions class = worldwide; anything else = not worldwide
    const navState = await page.evaluate(() => {
      const locDiv = document.querySelector('#location-popover') || document.querySelector('.page-nav-location-label');
      if (!locDiv) return { found: false, isWorldwide: false, label: '' };
      const span = locDiv.querySelector('span.d-lg-inline-block');
      const svg  = locDiv.querySelector('svg');
      const iconClass = svg ? (svg.className.baseVal || svg.getAttribute('class') || '') : '';
      const label = span ? span.textContent.trim() : '';
      return { found: true, label, isWorldwide: label === 'ALL' || iconClass.includes('icon-regions') };
    }).catch(() => ({ found: false, isWorldwide: false, label: '' }));

    if (!force && navState.isWorldwide) {
      console.log(`[WS] Location already Worldwide (nav="${navState.label}")`);
      return false;
    }

    const detected = navState.found ? `"${navState.label}"` : '(nav not found)';
    console.log(`[WS] Setting location to Worldwide (nav=${detected}, force=${force})...`);

    // ── Step 1: Click #location-popover to open the popover ──────────────────
    let popoverOpened = false;
    for (const sel of ['#location-popover', 'div.page-nav-location-label']) {
      try {
        await page.locator(sel).first().click({ force: true, timeout: 3000 });
        popoverOpened = true;
        break;
      } catch (e) { /* try next */ }
    }
    if (!popoverOpened) {
      popoverOpened = await page.evaluate(() => {
        const el = document.querySelector('#location-popover') || document.querySelector('.page-nav-location-label');
        if (!el) return false;
        el.click();
        return true;
      }).catch(() => false);
    }
    if (!popoverOpened) {
      console.log('[WS] Could not click location popover trigger');
      await _saveDiag(page, 'ws_location_no_popover_trigger');
      return false;
    }
    await page.waitForTimeout(800);

    // Solve captcha if it appeared after clicking the popover
    const innerPop = ((await page.evaluate(() => document.body.innerText).catch(() => '')) || '').toLowerCase();
    const htmlPop  = (await page.content().catch(() => '')).toLowerCase();
    if (PX_SIGNALS.some(sig => (innerPop + ' ' + htmlPop).includes(sig))) {
      console.log('[WS] PX captcha detected during location set — attempting solve...');
      const cleared = await _solvePxCaptcha(page);
      if (!cleared) {
        console.log('[WS] PX not cleared — skipping location set');
        await _saveDiag(page, 'ws_location_px_blocked');
        return false;
      }
      // Re-open popover after captcha clears
      for (const sel of ['#location-popover', 'div.page-nav-location-label']) {
        try { await page.locator(sel).first().click({ force: true, timeout: 3000 }); break; } catch (e) {}
      }
      await page.waitForTimeout(800);
    }

    // If popover already says Worldwide and not forcing, nothing to do
    const popoverText = await page.locator('.popover-body').innerText({ timeout: 1500 }).catch(() => '');
    if (!force && popoverText.toLowerCase().includes('worldwide')) {
      console.log('[WS] Location already Worldwide (popover confirmed)');
      try { await page.keyboard.press('Escape'); } catch (e) {}
      return false;
    }

    // ── Step 2: Click "Change location" in the popover to open the modal ──────
    let modalOpened = false;
    for (const sel of ['span.change-location.js-location', '.change-location.js-location', 'span.js-location']) {
      try {
        const el = page.locator(sel).first();
        await el.waitFor({ state: 'visible', timeout: 2000 });
        await el.click({ timeout: 3000 });
        modalOpened = true;
        console.log(`[WS] Opened location modal via "${sel}"`);
        break;
      } catch (e) { /* try next */ }
    }
    if (!modalOpened) {
      console.log('[WS] Could not open location modal');
      await _saveDiag(page, 'ws_location_no_modal_btn');
      return false;
    }

    await page.waitForTimeout(1000);

    // ── Step 3: Click worldwide button if not already active ─────────────────
    const isActive = await page.evaluate(() => {
      const btn = document.querySelector('.google-map__worldwide-button');
      return btn ? btn.classList.contains('active') : false;
    }).catch(() => false);

    if (!isActive) {
      let wwClicked = false;
      for (const sel of ['.google-map__worldwide-button', '.google-map__worldwide-button .js-toggle-worldwide']) {
        try {
          const el = page.locator(sel).first();
          await el.waitFor({ state: 'visible', timeout: 3000 });
          await el.click({ timeout: 3000 });
          wwClicked = true;
          console.log(`[WS] Selected Worldwide via "${sel}"`);
          break;
        } catch (e) { /* try next */ }
      }
      if (!wwClicked) {
        console.log('[WS] Could not find Worldwide option in modal');
        await _saveDiag(page, 'ws_location_no_worldwide_btn');
        return false;
      }
      await page.waitForTimeout(500);
    }

    // ── Step 4: Click "Save" to commit the worldwide selection ────────────────
    try {
      const saveBtn = page.locator('button.js-save-location').first();
      await saveBtn.waitFor({ state: 'visible', timeout: 3000 });
      await saveBtn.click({ timeout: 3000 });
      console.log('[WS] Clicked Save — worldwide preference committed');
    } catch (e) {
      console.log(`[WS] Save button not found: ${e.message} — proceeding anyway`);
    }

    // Wait for the modal to close and PJAX to finish updating the page.
    try { await page.locator('.modal.show, .modal.fade.show').waitFor({ state: 'hidden', timeout: 8000 }); } catch (e) {}
    await page.waitForTimeout(3000);
    console.log('[WS] Location set to Worldwide');
    return true;
  } catch (e) {
    console.log(`[WS] Location enforcement skipped (non-fatal): ${e.message}`);
    return false;
  }
}

async function _waitForPxClear(page, maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const inner = ((await page.evaluate(() => document.body.innerText)) || '').toLowerCase();
      const html = (await page.content()).toLowerCase();
      if (!PX_SIGNALS.some(sig => (inner + ' ' + html).includes(sig))) return true;
      await page.waitForTimeout(2000);
    } catch (e) {
      return true; // page navigated away — treat as clear
    }
  }
  return false;
}

function _extractPrice(text) {
  if (!text) return null;
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (m) return '$' + m[1];
  const m2 = text.match(/([€£]\s*[\d,]+(?:\.\d+)?)/);
  return m2 ? m2[1] : null;
}

function _roundPrice(priceStr) {
  if (!priceStr) return priceStr;
  const m = priceStr.match(/^([$€£])\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return priceStr;
  return m[1] + Math.round(parseFloat(m[2].replace(/,/g, ''))).toLocaleString('en-US');
}

function _floorPrice(priceStr) {
  if (!priceStr) return priceStr;
  const m = priceStr.match(/^([$€£])\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return priceStr;
  return m[1] + Math.floor(parseFloat(m[2].replace(/,/g, ''))).toLocaleString('en-US');
}

// Bottle-size rules shared by _extractCtSize, _normalizeBottleSize, _sizeToMl
const _CT_SIZE_RULES = [
  [/double\s*magnum|3\s*l\b|3[\s,.]0+\s*l|3000\s*ml/i, '3l'],
  [/\bmagnum\b|1\.5\s*l\b|1[\s,.]5+\s*l|1500\s*ml/i, '1.5l'],
  [/half\s*bottle|demi\b|375\s*ml|0\.375/i, '375ml'],
  [/jeroboam|4\.5\s*l\b|4500\s*ml/i, '4.5l'],
  [/imperial|methuselah|6\s*l\b|6000\s*ml/i, '6l'],
  [/salmanazar|9\s*l\b|9000\s*ml/i, '9l'],
  [/balthazar|12\s*l\b|12000\s*ml/i, '12l'],
];
const _WS_VOLUME_MAP = { '375ml': 375, '750ml': 750, '1.5l': 1500, '3l': 3000, '4.5l': 4500, '6l': 6000, '9l': 9000, '12l': 12000 };

function _normalizeBottleSize(size) {
  if (!size) return '750ml';
  for (const [pattern, norm] of _CT_SIZE_RULES) {
    if (pattern.test(size)) return norm;
  }
  const s = String(size).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/(\d+\.?\d*)(cl|ml|l)$/);
  if (m) {
    let v = parseFloat(m[1]);
    const unit = m[2];
    if (unit === 'cl') v /= 100;
    else if (unit === 'ml') v /= 1000;
    if (v < 0.5) return '375ml';
    if (v < 1.1) return '750ml';
    if (v < 2.5) return '1.5l';
    if (v < 4.0) return '3l';
    if (v < 5.5) return '4.5l';
    if (v < 7.5) return '6l';
  }
  return '750ml';
}

// Strip bottle-size terms from wine name so CT autocomplete matches on name only
const _STRIP_SIZE_RE = /\b(?:double\s*magnum|magnum|half\s*bottle|demi|jeroboam|imperial|methuselah|salmanazar|balthazar|\d+\.?\d*\s*(?:ml|l|cl))\b/gi;
function _stripSizeFromName(name) {
  return (name || '').replace(_STRIP_SIZE_RE, '').replace(/\s{2,}/g, ' ').trim();
}

// Strip accented characters to ASCII (CT autocomplete needs plain ASCII)
function _stripAccents(text) {
  return (text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

// Bag-of-characters similarity ratio (approximates Python SequenceMatcher.ratio()).
// Returns 0\u20131; used as a tiebreaker in token-aware scoring.
function _simRatio(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bMap = new Map();
  for (const c of b) bMap.set(c, (bMap.get(c) || 0) + 1);
  let matches = 0;
  for (const c of a) {
    const n = bMap.get(c) || 0;
    if (n > 0) { matches++; bMap.set(c, n - 1); }
  }
  return 2 * matches / (a.length + b.length);
}

// Infer bottle size from a CT search result label (e.g. "2015 Salon … Magnum")
function _extractCtSize(label) {
  for (const [pattern, size] of _CT_SIZE_RULES) {
    if (pattern.test(label)) return size;
  }
  return '750ml';
}

// Convert size string to ml value
function _sizeToMl(size) {
  if (!size) return 750;
  return _WS_VOLUME_MAP[_normalizeBottleSize(size)] || 750;
}

function _sizeToWsVolume(size) {
  if (!size) return null;
  const vol = _WS_VOLUME_MAP[_normalizeBottleSize(size)];
  return (vol && vol !== 750) ? vol : null;
}

// ── WS autocomplete helpers ───────────────────────────────────────────────────

// Generic wine/appellation words that appear in almost every entry and don't
// help disambiguate cuvées.  Kept separate from meaningful descriptors
// (brut, blanc, sec, rosé) that DO distinguish products.
const _WS_MATCH_STOPWORDS = new Set([
  'champagne', 'grand', 'cru', '1er', 'premier',
  'the', 'a', 'an', 'au', 'aux', 'le', 'la', 'les',
  'du', 'des', 'de', 'd', 'et', 'sur',
]);

// Query WS's uni-search autocomplete endpoint and return up to `limit` product matches.
// Response entries have: swd (display name), link (URL slug for /find/), type, i (wine ID).
async function _wsAutocomplete(wsPage, query, limit = 10) {
  if (!query) return [];
  const url = `${WS_BASE}/ajax/ng/csearch/uni-search?q=1&p=1&c=wine&k=${encodeURIComponent(query)}&v=`;
  try {
    const raw = await wsPage.evaluate(async (u) => {
      const r = await fetch(u, {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' },
      });
      return await r.text();
    }, url) || '';
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(e => e && typeof e === 'object' && e.type === 'product').slice(0, limit);
  } catch (e) {
    console.log(`[WS autocomplete] Failed for "${query}": ${e.message}`);
    return [];
  }
}

// Token-aware best-match picker over WS autocomplete results.
// Counts only DISTINCTIVE input tokens (strips stopwords) — common appellation
// words like "champagne" and "grand cru" match every entry and skew the score.
// Ties are broken by WS's own relevance ordering (first returned = highest confidence).
function _pickBestWsMatch(query, results) {
  if (!results || !results.length) return null;
  if (results.length === 1) return results[0];
  const q = _stripAccents(query).toLowerCase();
  const allTokens   = q.split(/[\s'"]+/).filter(Boolean);
  const distinctive = allTokens.filter(t => !_WS_MATCH_STOPWORDS.has(t));
  const scoring     = distinctive.length ? distinctive : allTokens;

  function score(entry) {
    const target = _stripAccents(entry.swd || '').toLowerCase();
    const tok    = scoring.filter(t => target.includes(t)).length;
    const ratio  = _simRatio(q, target);
    return [tok, ratio, -target.length];
  }

  return results.reduce((best, entry) => {
    const [bt, br, bl] = score(best);
    const [et, er, el] = score(entry);
    if (et > bt) return entry;
    if (et === bt && er > br) return entry;
    if (et === bt && er === br && el > bl) return entry;
    return best;
  });
}

// From a list of [sizeHint, url] pairs for one vintage, pick the URL matching requested size.
// Falls back to first candidate (usually 750ml standard) if no exact match.
function _bestCtUrlForSize(candidates, requestedSize) {
  if (!candidates || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0][1];
  if (!requestedSize) return candidates[0][1];
  const req = _normalizeBottleSize(requestedSize);
  for (const [sizeHint, url] of candidates) {
    if (sizeHint === req) return url;
  }
  return candidates[0][1];
}

async function ct_get_wine_data(page, wine_url, size = '') {
  const result = { ct_avg: null, ct_auction: null, ct_error: null };
  try {
    // Use 'load' (not 'domcontentloaded') so network requests triggered by the page
    // HTML have a chance to fire before we start waiting for React.
    await page.goto(wine_url, { waitUntil: 'load', timeout: 30000 });
    // CT redirects to payment.asp when a subscription is required — bail immediately.
    if (page.url().includes('/payment.asp')) {
      result.ct_error = 'Cellar Tracker: subscription required to view pricing for this wine';
      return result;
    }
    // CT wine pages are React SPAs — pricing data is rendered client-side.
    // waitForFunction exits as soon as the paywall element OR pricing section appears —
    // no fixed 8 s wait when CT shows the paywall immediately.
    try {
      await page.waitForFunction(
        () => {
          if (document.querySelector('a.paywall[href="payment.asp"]')) return true;
          const t = document.body?.innerText || '';
          return t.length > 300 && (
            /Community\s+Average\s+Value/i.test(t) ||
            /could not find/i.test(t)
          );
        },
        { timeout: 8000 }
      );
    } catch (e) {
      // Pricing section not detected — give React a fixed extra window
      await page.waitForTimeout(4000);
    }

    // Paywall: CT shows <a class="paywall" href="payment.asp"> for both Community Average
    // Value and Auction price when the account doesn't have a subscription.
    // Detected here (not on URL) because CT may serve the wine page then inject the
    // paywall links client-side without redirecting to payment.asp.
    const isPaywalled = await page.evaluate(
      () => !!document.querySelector('a.paywall[href="payment.asp"]')
    ).catch(() => false);
    if (isPaywalled) {
      result.ct_error = CT_PAYWALL_ERR;
      return result;
    }

    // CT hides community average behind a "Show Value" button for logged-in free accounts.
    // Click it to reveal the actual price, then wait for React to update the DOM.
    const showValueBtn = page.getByText('Show Value', { exact: true });
    const hasShowValue = await showValueBtn.isVisible({ timeout: 1500 }).catch(() => false);
    if (hasShowValue) {
      await showValueBtn.click().catch(() => {});
      // Wait for the price to appear (replaces "Show Value" text)
      try {
        await page.waitForFunction(
          () => /Community\s+Average\s+Value[^:]*:\s*\$[\d,]/.test(document.body?.innerText || ''),
          { timeout: 6000 }
        );
      } catch (e) { /* price may be fully paywalled — fall through and check text */ }
    }
    // Similarly try to reveal auction price
    const showAucBtn = page.getByText('Show Auction Value', { exact: false });
    const hasShowAuc = await showAucBtn.first().isVisible({ timeout: 500 }).catch(() => false);
    if (hasShowAuc) {
      await showAucBtn.first().click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    const text = (await page.evaluate(() => document.body.innerText)) || '';

    // Hard CloudFront WAF block
    if (text.includes('Generated by cloudfront') || text.includes('Request blocked') || text.includes('403 ERROR')) {
      result.ct_error = 'Cellar Tracker: access blocked by security filter — please reconnect';
      return result;
    }

    // Pick best price from [size_label, price_str] pairs, preferring requested size.
    // When no exact size match, extrapolate proportionally from the 750ml entry.
    function pickSizePrice(pairs) {
      if (!pairs || !pairs.length) return null;
      if (size) {
        const norm = _normalizeBottleSize(size);
        const found = pairs.find(p => _normalizeBottleSize(p[0]) === norm);
        if (found) return '$' + found[1];
        // No exact match — extrapolate from 750ml (or first available)
        const reqMl = _sizeToMl(size);
        if (reqMl !== 750) {
          const base750 = pairs.find(p => _normalizeBottleSize(p[0]) === '750ml');
          const baseEntry = base750 || pairs[0];
          const baseMl = base750 ? 750 : _sizeToMl(baseEntry[0]);
          const basePrice = parseFloat(baseEntry[1].replace(/,/g, ''));
          if (!isNaN(basePrice) && baseMl > 0) {
            return '$' + (basePrice * reqMl / baseMl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
        }
      }
      return '$' + pairs[0][1]; // fallback: first entry (typically 750ml)
    }

    // ── Community Average Value ─────────────────────────────────────────────
    // New CT format: "Community Average Value: $5,391.80; $5,638.47 (1.5L); …"
    // Old CT format: "Community average value: 750ml @ $5,391.80 (23 users); 1.5L @ $5,638.47"
    const mAvgLine = text.match(/Community\s+Average\s+Value[^:\n]*:([^\n]+)/i);
    if (mAvgLine) {
      const avgLine = mAvgLine[1];
      // Try new format first: "$PRICE (SIZE)"
      const newPairs = [];
      const reNew = /\$([\d,]+(?:\.\d+)?)\s*(?:\(([^)]+)\))?/g;
      let mm;
      while ((mm = reNew.exec(avgLine)) !== null) {
        const price = mm[1];
        const inParens = (mm[2] || '').trim();
        const sz = /\d+\s*(?:ml|l)\b/i.test(inParens) ? inParens : '750ml';
        newPairs.push([sz, price]);
      }
      // Use new-format pairs only when at least one explicit non-750ml size was found
      if (newPairs.length && newPairs.some(p => _normalizeBottleSize(p[0]) !== '750ml')) {
        result.ct_avg = pickSizePrice(newPairs);
      } else {
        // Try old format: "SIZE @ $PRICE"
        const oldPairs = [...avgLine.matchAll(/(\d+\.?\d*\s*[mLlMm]+)\s*@\s*\$([\d,]+(?:\.\d+)?)/gi)].map(m => [m[1], m[2]]);
        if (oldPairs.length) {
          result.ct_avg = pickSizePrice(oldPairs);
        } else if (newPairs.length) {
          result.ct_avg = pickSizePrice(newPairs); // fall back to new-format single price
        } else {
          const m = avgLine.match(/\$([\d,]+(?:\.\d+)?)/);
          if (m) result.ct_avg = '$' + m[1];
        }
      }
      // Paywall: no price in avg line — only store if it actually contains a $ amount
      if (!result.ct_avg) {
        const paywallText = avgLine.replace(/\s+/g, ' ').trim();
        if (paywallText && /\$[\d,]/.test(paywallText)) result.ct_avg = paywallText;
      }
    } else {
      // Fallback: scan for "Community Average Value" anywhere on page
      const m = text.match(/Community\s+[Aa]verage\s+[Vv]alue[^$]*\$([\d,]+(?:\.\d+)?)/);
      if (m) result.ct_avg = '$' + m[1];
    }

    // ── Wine Market Journal Auction Price ───────────────────────────────────
    // CT format: "Auction (Wine Market Journal): $5,203.28 (1.5L); $7,344.25 (6.0L)"
    // Old format: "Wine Market Journal …: Wine Name - 1.5L @ $5,203.28; 6.0L @ $7,344.25"
    const mAucLine = text.match(/(?:Auction\s*\([^)]*Journal[^)]*\)|Wine\s+Market\s+Journal)[^:\n]*:([^\n]+)/i);
    if (mAucLine) {
      const aucLine = mAucLine[1];
      const newAuc = [];
      const reAuc = /\$([\d,]+(?:\.\d+)?)\s*(?:\(([^)]+)\))?/g;
      let mm2;
      while ((mm2 = reAuc.exec(aucLine)) !== null) {
        const price = mm2[1];
        const inParens = (mm2[2] || '').trim();
        const sz = /\d+\s*(?:ml|l)\b/i.test(inParens) ? inParens : '750ml';
        newAuc.push([sz, price]);
      }
      if (newAuc.length && newAuc.some(p => _normalizeBottleSize(p[0]) !== '750ml')) {
        result.ct_auction = pickSizePrice(newAuc);
      } else {
        const oldAuc = [...aucLine.matchAll(/(\d+\.?\d*\s*[mLlMm]+)\s*@\s*\$([\d,]+(?:\.\d+)?)/gi)].map(m => [m[1], m[2]]);
        if (oldAuc.length) {
          result.ct_auction = pickSizePrice(oldAuc);
        } else if (newAuc.length) {
          result.ct_auction = pickSizePrice(newAuc);
        } else {
          const m = aucLine.match(/\$([\d,]+(?:\.\d+)?)/);
          if (m) result.ct_auction = '$' + m[1];
        }
      }
    } else {
      // Fallback: line-scan for any "auction" or "wine market journal" keyword
      const lines = text.split(/\r?\n/);
      const aucKw = /auction|wine\s+market\s+journal/i;
      for (let i = 0; i < lines.length; i++) {
        if (aucKw.test(lines[i])) {
          for (let j = i; j < Math.min(i + 6, lines.length); j++) {
            const pm = lines[j].match(/\$([\d,]+(?:\.\d+)?)/);
            if (pm) { result.ct_auction = '$' + pm[1]; break; }
          }
          if (result.ct_auction) break;
        }
      }
    }

    // Paywall fallback for auction — only store if it's an actual price (contains $)
    if (!result.ct_auction) {
      const mAucPriceLine = text.match(/Auction\s+price[^:\n]*:([^\n]+)/i);
      if (mAucPriceLine) {
        const aucText = mAucPriceLine[1].replace(/\s+/g, ' ').trim();
        if (aucText && /\$[\d,]/.test(aucText)) result.ct_auction = aucText;
      }
    }

    if (!result.ct_avg && !result.ct_auction) {
      const isPaywall = /Show\s+Value|Show\s+Auction\s+Value/i.test(text);
      result.ct_error = isPaywall ? 'not paid account' : 'Cellar Tracker: could not parse pricing';
    }
    if (result.ct_avg)     result.ct_avg     = _roundPrice(result.ct_avg);
    if (result.ct_auction) result.ct_auction = _roundPrice(result.ct_auction);
  } catch (err) {
    result.ct_error = `Cellar Tracker: page load error – ${err}`;
  }
  return result;
}

// Warm-up navigation before the first wine in a batch.
// Navigate to a WS search page and ensure the location is set to Worldwide
// before any wine searches begin. Non-fatal — any failure just logs a warning.
async function _primeWsLocation(page) {
  try {
    // Clear stale PX cookies and location-preference cookies before the batch warm-up.
    // Stale _px* cookies trigger an immediate PX challenge; stale ws_prof/ws_loc cookies
    // can lock the session into a country even after the modal is set to Worldwide.
    const ctx = page.context();
    try {
      const allCookies = await ctx.cookies();
      const wsCookies = allCookies.filter(c => (c.domain || '').includes('wine-searcher'));
      const toRemove = wsCookies.filter(c =>
        c.name.startsWith('_px') ||
        ['ws_prof', 'ws_cart_idUS', 'ws_loc'].includes(c.name)
      );
      if (toRemove.length > 0) {
        const keep = allCookies.filter(c => !toRemove.some(r => r.name === c.name && r.domain === c.domain));
        await ctx.clearCookies();
        if (keep.length > 0) await ctx.addCookies(keep);
        console.log(`[WS] Cleared PX+location cookies: ${toRemove.map(c => c.name).join(', ')}`);
      }
    } catch (e) {
      console.log(`[WS] Cookie clear skipped: ${e.message}`);
    }

    const url = `${WS_BASE}/find/-/any/-/-/ndbipe?Xtax_mode=e&shoptype=1%2C0`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    const pxCleared = await _waitForPxClear(page, 8000);
    if (!pxCleared) {
      console.log('[WS] PX captcha on prime URL — attempting solve...');
      await _solvePxCaptcha(page);
    }

    // force=true: always open modal and save Worldwide regardless of active-class state.
    const changed = await _ensureWsWorldwide(page, true);
    if (changed) {
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
      await page.waitForTimeout(1000);
    }

    try {
      const addr = await page.locator('.change-location .address, .filter-list__item .address').first()
        .textContent({ timeout: 2000 }).catch(() => null);
      console.log(`[WS] Pre-batch location prime complete — sidebar="${addr?.trim() || 'unknown'}"`);
    } catch (e) {
      console.log('[WS] Pre-batch location prime complete');
    }
  } catch (exc) {
    console.log(`[WS] Pre-batch location prime skipped — ${exc.message}`);
  }
}

async function ws_get_wine_data(page, search_url, _size = '', exclude_auctions = true, skipWorldwideCheck = false) {
  const result = { ws_matched: null, ws_wine_url: null, ws_avg: null, ws_min: null, ws_error: null, ws_no_results: false };
  try {
    await page.goto(search_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for JS to settle (networkidle, capped) then add a human-like buffer.
    // networkidle fires as soon as the page goes quiet so we don't over-sleep on fast loads.
    try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch (e) {}
    await page.waitForTimeout(1000 + Math.random() * 800);
    await _waitForPxClear(page, 10000);

    let html = await page.content();
    let text = (await page.evaluate(() => document.body.innerText)) || '';
    let actual_url = page.url() || search_url;
    console.log(`[WS] Landed on: ${actual_url.slice(0, 120)}`);

    if (PX_SIGNALS.some(sig => (text + html).toLowerCase().includes(sig))) {
      console.log('[PX] Captcha detected during wine search — attempting behavioral solve...');
      // Pre-solve jitter: randomise start time per-user so concurrent sessions
      // don't hit the captcha endpoint in a synchronized burst (1–6 s spread).
      const preSolveJitter = 1000 + Math.random() * 5000;
      console.log('[PX] Pre-solve wait ' + Math.round(preSolveJitter) + 'ms...');
      await page.waitForTimeout(preSolveJitter);
      let pxCleared = await _solvePxCaptcha(page);

      if (!pxCleared) {
        await _saveDiag(page, 'ws_search_px_blocked');
        // Signal caller to wipe the profile and retry with a fresh fingerprint
        console.log('[PX] Auto-solve failed — signalling caller for profile wipe + retry');
        result.ws_error = WS_PX_BLOCKED;
        return result;
      }

      // Captcha cleared — reload the search URL to get actual results
      console.log('[PX] Captcha cleared! Reloading search URL...');
      await page.goto(search_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);
      html = await page.content();
      text = (await page.evaluate(() => document.body.innerText)) || '';
    }

    // ── Worldwide location enforcement ────────────────────────────────────────
    // Skipped when caller already confirmed worldwide at batch start (_primeWsLocation).
    // Only runs when skipWorldwideCheck=false (e.g. after a PX captcha wipe reset session).
    if (!skipWorldwideCheck && await _ensureWsWorldwide(page)) {
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {}
      await page.waitForTimeout(2000);
      html = await page.content();
      text = (await page.evaluate(() => document.body.innerText)) || '';
      actual_url = page.url() || search_url;
    }

    // Detect WS "no results" page before trying to parse prices.
    // isHardNoResults = WS has zero matches for this name at any vintage (skip vintage fallbacks).
    const lowerText      = text.toLowerCase();
    const isHardNoResults = /could not find any products/i.test(text);
    const isNoResults    = isHardNoResults ||
      /no results found|no wines found/i.test(text) ||
      (lowerText.includes('showing results for') && !lowerText.includes('avg price'));

    if (isNoResults) {
      // Before giving up, check if WS rendered a "Products for '...'" carousel.
      // If so, the first card's /find/ href points to the closest matching wine —
      // follow it (preserving vintage + params from original URL) and parse prices there.
      const carouselEl = await page.$('.card-product__name a[href^="/find/"], .card-product a[href^="/find/"]').catch(() => null);
      const foundHref  = carouselEl ? await carouselEl.getAttribute('href').catch(() => null) : null;

      if (foundHref) {
        try {
          // Rebuild URL: replace the name segment, keep vintage + trailing params intact.
          const urlObj      = new URL(search_url);
          const suffix      = urlObj.pathname.split('/').slice(3).join('/');
          const redirectUrl = `${WS_BASE}${foundHref}/${suffix}${urlObj.search}`;
          console.log(`[WS carousel] No exact match — following carousel link: ${foundHref}`);
          await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(2000 + Math.random() * 1000);
          html       = await page.content();
          text       = (await page.evaluate(() => document.body.innerText)) || '';
          actual_url = page.url() || redirectUrl;
          // Fall through to normal price extraction below
        } catch (e) {
          console.log(`[WS carousel] Redirect failed: ${e.message}`);
          if (isHardNoResults) result.ws_no_results = true;
          result.ws_error = 'Wine-Searcher: wine not found — try adjusting the name or vintage';
          return result;
        }
      } else {
        if (isHardNoResults) result.ws_no_results = true;
        result.ws_error = 'Wine-Searcher: wine not found — try adjusting the name or vintage';
        return result;
      }
    }

    const lines = text.split(/\r?\n/);

    // ── Average Price (5 strategies, most specific first) ──────────────────
    let avg_price = null;

    // Strategy 1: "Average Price" / "Avg Price" with $ on the same line
    const m1 = text.match(/[Aa]v(?:erage|g)\s+[Pp]rice[^\n$]{0,40}\$([\d,]+(?:\.\d+)?)/);
    if (m1) avg_price = '$' + m1[1];

    // Strategy 2: label on its own line, price on a nearby line (real WS format:
    //   "Avg Price (ex-tax)\n$ 6,213 / 750ml")
    if (!avg_price) {
      for (let i = 0; i < lines.length; i++) {
        if (/[Aa]v(?:erage|g)\s+[Pp]rice/.test(lines[i])) {
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            const p = _extractPrice(lines[j]);
            if (p) { avg_price = p; break; }
          }
        }
        if (avg_price) break;
      }
    }

    // Strategy 3: any "average"/"avg" keyword within first 3000 chars (stats region)
    if (!avg_price) {
      const topLines = text.slice(0, 3000).split(/\r?\n/);
      for (let i = 0; i < topLines.length; i++) {
        if (/\b(?:average|avg)\b/i.test(topLines[i])) {
          for (let j = i; j < Math.min(i + 6, topLines.length); j++) {
            const p = _extractPrice(topLines[j]);
            if (p) { avg_price = p; break; }
          }
        }
        if (avg_price) break;
      }
    }

    // Strategy 4: HTML class-based (server-rendered fragments)
    // Matches any element whose class attribute contains "average" or "avg-/avg_price"
    if (!avg_price) {
      const reClass = /class="[^"]*(?:average|avg.?price)[^"]*"[^>]*>([\s\S]{0,200}?)<\//gi;
      let cm;
      while ((cm = reClass.exec(html)) !== null) {
        const p = _extractPrice(cm[1].replace(/<[^>]+>/g, ' ').trim());
        if (p) { avg_price = p; break; }
      }
    }

    // Strategy 5: raw HTML regex as last resort
    if (!avg_price) {
      const mm = html.match(/(?:average|avg\s+price)[^<]{0,60}?\$([\d,]+(?:\.\d+)?)/i);
      if (mm) avg_price = '$' + mm[1];
    }

    // ── Minimum price from merchant list (independent of avg_price) ──────────
    // Find start of merchant section using the most reliable anchors.
    const setAlertM = text.match(/\bSet\s+alert\b/i);
    const statsFromM = text.match(/\bFrom\b\s*\$\s*([\d,]+(?:\.\d+)?)(?!\s*\/month)(?!\s*per\s+month)/);
    const avgAnchorIdx = text.search(/[Aa]v(?:erage|g)\s+[Pp]rice/);

    let merchStart;
    if (setAlertM) {
      merchStart = setAlertM.index + setAlertM[0].length;
    } else if (statsFromM) {
      merchStart = statsFromM.index + statsFromM[0].length;
    } else if (avgAnchorIdx >= 0) {
      merchStart = avgAnchorIdx + 600;
    } else {
      merchStart = 1500;
    }

    let merchText = text.slice(merchStart);

    // Trim at end-of-listings markers to exclude sidebars / related products.
    const endM = merchText.match(/Not what you.{0,10}re looking for|\bAlso from\b.{1,60}Learn more|Check with the merchant for stock/i);
    if (endM) merchText = merchText.slice(0, endM.index);

    const merchLines = merchText.split(/\r?\n/);
    const amounts = [];

    for (let i = 0; i < merchLines.length; i++) {
      const stripped = merchLines[i].trim();
      if (!stripped) continue;

      // Accept standalone "$X" price line OR price at the very end of a line
      let mPrice = stripped.match(/^\$\s*([\d,]+(?:\.\d+)?)\s*$/);
      if (!mPrice) {
        mPrice = stripped.match(/\$\s*([\d,]+(?:\.\d+)?)\s*$/);
        // Skip summary/header lines that happen to contain a price
        if (mPrice && /(?:from|average|avg|range|price|~|approx|about|over|above|orders)\b/i.test(stripped.slice(0, stripped.lastIndexOf('$')))) {
          mPrice = null;
        }
      }
      if (!mPrice) continue;

      if (exclude_auctions) {
        const ctx = merchLines.slice(Math.max(0, i - 5), i + 5).join('\n');
        if (AUCTION_KW.test(ctx)) continue;
      }
      try { amounts.push(parseFloat(mPrice[1].replace(/,/g, ''))); } catch (e) {}
    }

    let ws_min = null;
    if (amounts.length) {
      ws_min = '$' + Math.floor(Math.min(...amounts)).toLocaleString('en-US');
    } else if (statsFromM) {
      const candidate = _floorPrice('$' + statsFromM[1]);
      if (!exclude_auctions) {
        ws_min = candidate;
      } else {
        const ctx = text.slice(Math.max(0, statsFromM.index - 200), statsFromM.index + statsFromM[0].length + 50);
        if (!AUCTION_KW.test(ctx)) ws_min = candidate;
      }
    } else {
      const mm = html.match(/from[^<]{0,20}\$([\d,]+(?:\.\d+)?)/i);
      if (mm) ws_min = _floorPrice('$' + mm[1]);
    }

    if (avg_price) {
      result.ws_avg = _roundPrice(avg_price);
      if (ws_min) result.ws_min = ws_min;
      result.ws_wine_url = actual_url;
      // Wine name from <h1> or first meaningful line of rendered text
      const h1 = await page.$('h1');
      if (h1) {
        result.ws_matched = (await h1.innerText()).trim();
      } else {
        for (const line of lines) {
          const l = line.trim();
          if (l && l.length > 5 && !l.includes('$')) { result.ws_matched = l; break; }
        }
      }
    } else {
      result.ws_error = 'Wine-Searcher: could not find average price';
    }
  } catch (err) {
    result.ws_error = `Wine-Searcher: page load error – ${err}`;
  }
  return result;
}

// Standalone CT lookup: autocomplete → search.asp → wine.asp (or vintage resolution).
// Uses getlistglobal, fetch()-based requests (no page navigation for search steps),
// accent-stripping, progressive word dropping, and size-aware vintage URL selection.
// ── Status classification helper ─────────────────────────────────────────────
// Returns true ONLY for genuine system/network failures that should mark a row
// as status='error'. "Wine not found" and "no pricing data" messages are NOT
// real errors — those rows should still be status='completed'.
//
// No-data patterns (lookup ran fine, wine just wasn't found or priced):
//   CT: "no autocomplete results", "autocomplete returned nothing", "no results for",
//       "could not parse pricing"
//   WS: "wine not found", "no results found", "could not find" (avg price / any products)
// Skip patterns (intentional skips, not errors):
//   "not enabled", "no connection"
// Everything else (page load error, search error, session expired, blocked,
//   bot-detection, JS exceptions) → real error.
const _NO_DATA_PATTERNS = [
  'not enabled', 'no connection', 'not paid account',
  'wine not found', 'no results found', 'no results for',
  'could not find',          // covers "could not find average price" + "could not find any products"
  'could not parse pricing',
  'no autocomplete results', 'autocomplete returned nothing',
  'no wines found',
  'subscription required',   // CT paywall — not a real error, just no access
];
function _isRealError(msg) {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return !_NO_DATA_PATTERNS.some(p => lower.includes(p));
}

// ── Progressive name-trimming helpers ────────────────────────────────────────
// Returns an ordered list of shorter wine name candidates to try when the
// original full-name search returns "no wine found".
// Rules:
//  - Front-drop: drop words from the FRONT one at a time, stopping at 4 parts.
//    (Keeps "Château"/"Domaine" prefix intact as long as possible.)
//  - Back-drop: drop words from the BACK one at a time, stopping at 3 parts.
//    (Suffixes like "Réserve du Château" may not appear in WS — need to go lower.)
//  - If the name is 3 parts or fewer, returns an empty array (no fallback).
function _wsFallbackNames(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 3) return [];
  const candidates = [];
  // Front-drop pass: stop at 4 parts
  for (let i = 1; i <= parts.length - 4; i++) {
    candidates.push(parts.slice(i).join(' '));
  }
  // Back-drop pass: stop at 3 parts
  for (let i = 1; i <= parts.length - 3; i++) {
    candidates.push(parts.slice(0, parts.length - i).join(' '));
  }
  return candidates;
}

// Returns true when a ws_get_wine_data result means "wine not found on WS"
// (as opposed to a connection / PX / timeout error that shouldn't trigger fallback).
function _wsIsNotFound(r) {
  return !r.ws_avg && !r.ws_min && !r.ws_matched &&
    !!r.ws_error &&
    /wine not found|no results found|no wines found/i.test(r.ws_error);
}

// Wraps ws_get_wine_data with:
//   1. WS autocomplete slug resolution (one in-page fetch, cached in wsSlugCache)
//   2. Vintage fallback loop (±1, ±2 years) when wine exists but exact vintage unprice
//   3. Progressive name-trimming fallback when wine name has no WS match at all
async function _wsLookupWithFallback(wsPage, name, vintage, wsCurrency, size, wsSlugCache, wsWorldwideOk = false) {
  // Resolve canonical WS slug via autocomplete (cached per wine name across the batch).
  // The slug is the URL-ready identifier WS uses in /find/<slug>/<vintage>/... and
  // handles accents, appellation suffixes, quotes, and "Grand Cru" insertions that
  // cause a literal URL-encoded name to return zero results.
  let searchSlug = null;
  if (wsSlugCache) {
    const cacheKey = (name || '').trim().toLowerCase();
    if (!wsSlugCache.has(cacheKey)) {
      const matches = await _wsAutocomplete(wsPage, name);
      const best    = _pickBestWsMatch(name, matches);
      wsSlugCache.set(cacheKey, (best && best.link) ? best.link : null);
      if (best && best.link) {
        console.log(`[WS autocomplete] "${name}" → slug "${best.link}" (${best.swd || ''})`);
      } else {
        console.log(`[WS autocomplete] No match for "${name}" — using literal name`);
      }
    }
    searchSlug = wsSlugCache.get(cacheKey) || null;
  }

  function buildUrl(n, vtg, slug) {
    const nameSlug = slug || encodeURIComponent(n).replace(/%20/g, '+');
    const vtgStr   = vtg || 'any';
    const curr     = (wsCurrency || 'USD').toUpperCase();
    const wsVol    = _sizeToWsVolume(size);
    let url = `${WS_BASE}/find/${nameSlug}/${vtgStr}/-/${curr}/ndbipe?Xtax_mode=e&shoptype=1%2C0&Xsavecurrency=Y&Xsavelocation=Y`;
    if (wsVol) url += `&volume=${wsVol}`;
    return url;
  }

  const r0 = await ws_get_wine_data(wsPage, buildUrl(name, vintage, searchSlug), size, true, wsWorldwideOk);

  // ── Vintage fallback: wine found on WS but no price for this exact vintage ──
  // Skip when: WS said "could not find any products" (ws_no_results = wine doesn't exist),
  // or when we already got a price, or when vintage isn't a 4-digit year.
  if (!r0.ws_avg && !r0.ws_min && !r0.ws_no_results && !_wsIsNotFound(r0)
      && vintage && /^\d{4}$/.test(vintage)) {
    const yr          = parseInt(vintage, 10);
    const maxAltYear  = new Date().getFullYear() - 1;
    for (const delta of [-1, -2, 1, 2]) {
      const altYr = yr + delta;
      if (altYr > maxAltYear) continue;
      await wsPage.waitForTimeout(500 + Math.random() * 500);
      console.log(`[WS vintage fallback] "${name}" ${vintage} → trying ${altYr}`);
      const altR = await ws_get_wine_data(wsPage, buildUrl(name, String(altYr), searchSlug), size, true, wsWorldwideOk);
      if (altR.ws_avg || altR.ws_min) {
        altR.ws_vintage_fallback = String(altYr);
        return altR;
      }
      if (altR.ws_no_results) return altR; // wine itself has zero WS entries — stop early
    }
    return r0; // vintage fallback exhausted
  }

  // ── Name-trimming fallback: wine name not found on WS even with autocomplete ──
  if (_wsIsNotFound(r0)) {
    const fallbacks = _wsFallbackNames(name);
    if (!fallbacks.length) return r0;
    for (const shorter of fallbacks) {
      await wsPage.waitForTimeout(800 + Math.random() * 700);
      console.log(`[WS name fallback] "${name}" not found — retrying as "${shorter}"`);
      // Don't use autocomplete slug for trimmed names (different search term)
      const r = await ws_get_wine_data(wsPage, buildUrl(shorter, vintage, null), size, true, wsWorldwideOk);
      if (!_wsIsNotFound(r)) return r;
    }
  }

  return r0;
}

// ── CT progressive name-trimming fallback ────────────────────────────────────
// Same front-then-back strategy for Cellar Tracker.
// Returns true when a _doCtLookup result means "wine not found in CT"
// (no url returned AND error is a "not found / no results" message).
function _ctIsNotFound(r) {
  return !r.ct_url &&
    !!r.ct_err &&
    /no autocomplete|no results|wine not found|autocomplete returned nothing/i.test(r.ct_err);
}

// Wraps _doCtLookup with progressive name-trimming fallback.
async function _ctLookupWithFallback(ctPage, name, vintage, size) {
  const r0 = await _doCtLookup(ctPage, name, vintage, size);
  if (!_ctIsNotFound(r0)) return r0;

  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 3) return r0;

  // Front-drop pass: stop at 4 parts
  for (let i = 1; i <= parts.length - 4; i++) {
    await ctPage.waitForTimeout(300 + Math.random() * 600);
    const shorter = parts.slice(i).join(' ');
    console.log(`[CT fallback] "${name}" not found — retrying as "${shorter}"`);
    const r = await _doCtLookup(ctPage, shorter, vintage, size);
    if (!_ctIsNotFound(r)) return r;
  }
  // Back-drop pass: stop at 3 parts
  for (let i = 1; i <= parts.length - 3; i++) {
    await ctPage.waitForTimeout(300 + Math.random() * 600);
    const shorter = parts.slice(0, parts.length - i).join(' ');
    console.log(`[CT fallback] "${name}" not found — retrying as "${shorter}"`);
    const r = await _doCtLookup(ctPage, shorter, vintage, size);
    if (!_ctIsNotFound(r)) return r;
  }

  return r0;
}

async function _doCtLookup(ctPage, name, vintage, size) {
  let ct_matched = null, ct_url = null, ct_err = null, ct_data = {};
  try {
    // Strip bottle-size tokens from the name — CT autocomplete matches on wine name only
    const cleanName = _stripSizeFromName(name);

    // Build autocomplete query: remove vintage year, strip accents (CT needs ASCII)
    let acName = cleanName.replace(/\b\d{4}\b/g, '').trim().replace(/\s{2,}/g, ' ');
    acName = _stripAccents(acName);

    // Progressive word dropping: try full name first, keep dropping trailing words
    // until we get autocomplete results (min 2 words, matching Python logic)
    let acEntries = [];
    let words = acName.split(' ').filter(Boolean);
    while (words.length >= 2) {
      const query = words.join(' ');
      const acUrl = `${CT_BASE}/classic/ajaxwine.asp?List=getlistglobal&letters=${encodeURIComponent(query)}`;
      // Fetch via in-page context so CT session cookies are included; avoids page navigation.
      // Must decode as windows-1252 — CT autocomplete uses Latin-1 encoding.
      const acText = await ctPage.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        const buf = await r.arrayBuffer();
        return new TextDecoder('windows-1252').decode(buf);
      }, acUrl);
      acEntries = (acText || '').split('|')
        .map(p => p.includes('###') ? p.split('###', 2)[1].trim() : null)
        .filter(Boolean);
      if (acEntries.length) break;
      words.pop();
    }

    if (!acEntries.length) {
      ct_err = `Cellar Tracker: autocomplete returned nothing for '${acName}'`;
    } else {
      // Token-aware canonical selection (mirrors Python scraper.py _score logic).
      // 1. Strip leading vintage/NV marker from both input and candidate so "2016 Salon"
      //    and "N.V. Salon" don't pollute the token comparison.
      // 2. Count how many input tokens appear (as substrings) in the candidate —
      //    this discriminates cuvée names far better than pure character ratio.
      // 3. Tiebreak by character-level similarity ratio, then prefer shorter entry.
      function _ctNormalise(s) {
        return _stripAccents(s).toLowerCase().replace(/^(n\.?v\.?|mv|\d{4})\s+/i, '');
      }
      const acNameNorm  = _ctNormalise(acName);
      const inputTokens = acNameNorm.split(/\s+/).filter(Boolean);

      function _ctScore(entry) {
        const entNorm     = _ctNormalise(entry);
        const tokenHits   = inputTokens.filter(t => entNorm.includes(t)).length;
        const ratio       = _simRatio(acNameNorm, entNorm);
        return [tokenHits, ratio, -entNorm.length];
      }

      const canonical = acEntries.reduce((best, entry) => {
        const [bt, br, bl] = _ctScore(best);
        const [et, er, el] = _ctScore(entry);
        if (et > bt) return entry;
        if (et === bt && er > br) return entry;
        if (et === bt && er === br && el > bl) return entry;
        return best;
      });
      console.log(`[CT] autocomplete: '${acName}' → '${canonical}' (of ${acEntries.length})`);


      // Fetch search.asp using in-page fetch (preserves windows-1252 charset + cookies).
      // CT classic search.asp requires ASCII (Latin-1) URL encoding — UTF-8 returns 0 results.
      const searchUrl = `${CT_BASE}/classic/search.asp?S=${encodeURIComponent(_stripAccents(canonical))}`;
      const html = await ctPage.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        const buf = await r.arrayBuffer();
        return new TextDecoder('windows-1252').decode(buf);
      }, searchUrl);

      // Parse vintage links from search.asp HTML
      // vintage_map: { "2016": [[sizeHint, url], ...], ... }
      const vintage_map = {};
      let group_url = null;
      const linkRe = /<a[^>]+href=["']?([^"'>\s]+)["']?[^>]*>([^<]*)<\/a>/gi;
      let lm;
      while ((lm = linkRe.exec(html)) !== null) {
        const href = lm[1];
        const label = lm[2].trim();
        if (!/wine\.asp/i.test(href) || !/iWine=/i.test(href)) continue;
        const mId = href.match(/iWine=(\d+)/i);
        if (!mId || mId[1] === '0') continue;
        const clean = href.replace(/^(\.\.\/)+/, '');
        const full = clean.startsWith('http') ? clean : CT_BASE + '/' + clean.replace(/^\//, '');
        const mYear = label.match(/^(\d{4})\s+/);
        const mNv   = !mYear ? label.match(/^(N\.?V\.?|MV)\s+/i) : null;
        if (mYear) {
          const yr = mYear[1];
          const sizeHint = _extractCtSize(label);
          if (!vintage_map[yr]) vintage_map[yr] = [];
          vintage_map[yr].push([sizeHint, full]);
        } else if (mNv) {
          // Normalise all non-vintage markers (N.V., NV, MV) to a single "NV" key
          const sizeHint = _extractCtSize(label);
          if (!vintage_map['NV']) vintage_map['NV'] = [];
          vintage_map['NV'].push([sizeHint, full]);
        } else if (!group_url && label) {
          group_url = full;
        }
      }

      // Vintage selection — handles numeric years AND non-vintage (NV) entries.
      // Normalise: "N.V.", "n.v.", "MV" → "NV" to match the key we store above.
      const reqVintage    = (vintage && /^(N\.?V\.?|MV)$/i.test(vintage.trim())) ? 'NV' : vintage;
      const reqIsNumeric  = reqVintage && /^\d{4}$/.test(reqVintage);
      const vintageKeys   = Object.keys(vintage_map);
      const numericKeys   = vintageKeys.filter(k => /^\d{4}$/.test(k));

      if (reqVintage && vintage_map[reqVintage]) {
        // Exact match (works for "2020", "NV", etc.)
        ct_url     = _bestCtUrlForSize(vintage_map[reqVintage], size);
        const pfx  = reqVintage === 'NV' ? 'N.V.' : reqVintage;
        ct_matched = `${pfx} ${canonical}`;
      } else if (reqIsNumeric && numericKeys.length) {
        // Numeric vintage requested but not in map → nearest available year
        const nearest = numericKeys.reduce((a, b) =>
          Math.abs(parseInt(a) - parseInt(reqVintage)) <= Math.abs(parseInt(b) - parseInt(reqVintage)) ? a : b
        );
        ct_url     = _bestCtUrlForSize(vintage_map[nearest], size);
        ct_matched = `${nearest} ${canonical}`;
      } else if (reqVintage && !reqIsNumeric) {
        // Non-vintage requested but no NV entry — never substitute a numeric year;
        // use the wine-group page as the only honest fallback.
        if (group_url) {
          ct_url     = group_url;
          ct_matched = canonical;
        } else {
          ct_err = `Cellar Tracker: no non-vintage entry for '${canonical}'`;
        }
      } else if (!reqVintage && numericKeys.length) {
        // No vintage supplied — pick the latest available year
        const latest = numericKeys.sort((a, b) => parseInt(b) - parseInt(a))[0];
        ct_url     = _bestCtUrlForSize(vintage_map[latest], size);
        ct_matched = `${latest} ${canonical}`;
      } else if (group_url) {
        ct_url     = group_url;
        ct_matched = canonical;
      } else {
        ct_err = `Cellar Tracker: no results for '${canonical}'`;
      }
    }
  } catch (e) { ct_err = `Cellar Tracker: search error – ${e}`; }

  if (ct_url) {
    ct_data = await ct_get_wine_data(ctPage, ct_url, size);
  } else if (!ct_err) {
    ct_err = `Cellar Tracker: no results for '${name}'`;
  }
  return { ct_matched, ct_url, ct_err, ct_data };
}

async function runLookupForBatch(batchId, logger = () => {}, options = {}) {
  const pool = _getPool();

  let ctBrowser = null;
  let ctContext = null;
  let ctPage = null;
  let wsContext = null;
  let wsPage = null;
  let _wsBrowserFallback = null; // used when persistent context fails due to profile lock
  // Set to true when a source is marked connected in users_connections but has no
  // cookies in users_sessions (e.g. cookies were purged or user never used extension).
  // Used to surface a clear per-wine error instead of silently scraping unauthenticated.
  let ctSessionMissing = false;
  let wsSessionMissing = false;
  let wsWorldwideConfirmed = false; // set after _primeWsLocation; skips per-wine modal check

  let _semAcquired = false;
  try {
    // Acquire concurrency slot before launching any browsers.
    await _acquireSem(); _semAcquired = true;

    const r = await pool.query(
      'SELECT * FROM wine_lookups WHERE batch_id=$1 AND (is_deleted IS NULL OR is_deleted=false) ORDER BY row_order ASC NULLS LAST, created_date ASC',
      [batchId]
    );
    if (r.rowCount === 0) {
      console.log(`No records for batch ${batchId}`);
      return;
    }
    const records = r.rows;
    const userId = records[0]?.user_id || null;
    // Stable per-user fingerprint (same viewport + UA every session for this user,
    // different from other users).
    const profile = _pickProfile(userId);
    const wsCurrency = ((options && options.currency) || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';

    // ── Determine which sources are available for this user ─────────────────
    let ctConnected = false, ctEnabled = false, wsConnected = false, wsEnabled = false;
    if (userId) {
      try {
        const connR = await pool.query(
          "SELECT site_name, status, is_connected, is_enabled FROM users_connections WHERE user_id=$1",
          [userId]
        );
        for (const conn of connR.rows) {
          const s = (conn.site_name || '').toLowerCase();
          if (s.includes('cellar')) {
            ctConnected = conn.is_connected === true && conn.status === 'connected';
            ctEnabled = conn.is_enabled !== false;
          } else if (s.includes('wine')) {
            wsConnected = conn.is_connected === true && conn.status === 'connected';
            wsEnabled = conn.is_enabled !== false;
          }
        }
      } catch (e) {
        console.log(`Warning: could not fetch user connections: ${e}`);
      }
    } else {
      // No user_id — allow both sources (legacy mode)
      ctConnected = ctEnabled = wsConnected = wsEnabled = true;
    }
    console.log(`Source status — CT: connected=${ctConnected} enabled=${ctEnabled} | WS: connected=${wsConnected} enabled=${wsEnabled}`);

    // Fetch the residential proxy assigned to this user once; reused for all browser
    // launches below. Returns null when no proxy is assigned (dev/test or before
    // server mode is fully set up) — browsers fall back to the server's own IP.
    const proxyConfig = userId ? await getPlaywrightProxy(pool, userId).catch(() => null) : null;
    if (proxyConfig) console.log(`[proxy] Using residential proxy ${proxyConfig.server.replace(/\/\/.*@/, '//<redacted>@')}`);

    // ── Per-user WS browser profile dir ─────────────────────────────────────
    // Must match scrapers.js: {userId}/wine_searcher so PX profile state is shared
    // between the connect flow and the lookup flow for the same user.
    const wsProfileDir = userId
      ? path.join(WS_PROFILES_BASE, String(userId), 'wine_searcher')
      : WS_PROFILE_DIR;

    // ── Load session cookies from DB for both CT and WS ────────────────────
    async function loadSessionCookies(siteName) {
      if (!userId) return null;
      try {
        const cs = await pool.query(
          'SELECT session_cookies FROM users_sessions WHERE user_id=$1 AND site=$2 ORDER BY last_used DESC LIMIT 1',
          [userId, siteName]
        );
        if (cs.rowCount > 0 && cs.rows[0].session_cookies) {
          return decryptCookies(userId, cs.rows[0].session_cookies);
        }
      } catch (e) { /* no saved cookies */ }
      return null;
    }

    async function saveSessionCookies(siteName, context, domainFilter, cookiesOverride = null) {
      if (!userId) return;
      if (!context && !cookiesOverride) return;
      try {
        let relevant;
        if (cookiesOverride) {
          relevant = cookiesOverride.filter(c => !c.name.startsWith('_px'));
        } else {
          const all = await context.cookies();
          // Exclude _px* cookies: they expire within minutes/hours and injecting stale
          // PX cookies on the next run overrides the fresh profile state, making PX
          // bot-scoring worse. Let the persistent profile manage its own PX state.
          relevant = all.filter(c =>
            (c.domain || '').includes(domainFilter) && !c.name.startsWith('_px')
          );
        }
        if (relevant.length === 0) return;
        const cookieJson = encryptCookies(userId, relevant);
        const existing = await pool.query(
          'SELECT id FROM users_sessions WHERE user_id=$1 AND site=$2',
          [userId, siteName]
        );
        if (existing.rowCount > 0) {
          await pool.query(
            'UPDATE users_sessions SET session_cookies=$1, last_used=now() WHERE id=$2',
            [cookieJson, existing.rows[0].id]
          );
        } else {
          await pool.query(
            'INSERT INTO users_sessions(user_id, site, session_cookies, last_used) VALUES($1, $2, $3, now())',
            [userId, siteName, cookieJson]
          );
        }
        console.log(`${siteName} session cookies saved to DB`);
      } catch (e) {
        console.log(`Warning: could not save ${siteName} cookies: ${e}`);
      }
    }

    // ── Cellar Tracker browser — only init when CT is connected and enabled ──
    if (ctConnected && ctEnabled) {
      logger('Connecting to Cellar tracker');
      let savedCtCookies = await loadSessionCookies('cellar_tracker');
      if (!savedCtCookies || savedCtCookies.length === 0) {
        // No saved session — attempt a silent re-login before giving up so the user
        // doesn't need to manually reconnect just because cookies expired.
        const ctCred = options?.creds?.['cellar_tracker'];
        if (ctCred && ctCred.email && ctCred.password) {
          console.log('Cellar Tracker: no saved session — attempting auto-reconnect...');
          try {
            const reloginResult = await ctLogin(ctCred.email, ctCred.password, userId, proxyConfig);
            if (reloginResult.success && reloginResult.cookies && reloginResult.cookies.length > 0) {
              await saveSessionCookies('cellar_tracker', null, null, reloginResult.cookies);
              savedCtCookies = reloginResult.cookies;
              console.log('Cellar Tracker: auto-reconnect successful');
            } else {
              ctSessionMissing = true;
              console.log(`Cellar Tracker: auto-reconnect failed (${reloginResult.error}) — skipping CT`);
            }
          } catch (e) {
            ctSessionMissing = true;
            console.log(`Cellar Tracker: auto-reconnect error (${e.message}) — skipping CT`);
          }
        } else {
          ctSessionMissing = true;
          console.log('Cellar Tracker: no saved session cookies — skipping CT. Please reconnect in the Connections tab.');
        }
      }
      if (!ctSessionMissing) {
        // Prefer system Chrome — better TLS + canvas fingerprint beats CloudFront WAF.
        // Bundled Chromium is a known-bot fingerprint that CF blocks aggressively.
        const ctArgs = ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'];
        try {
          ctBrowser = await chromium.launch({ headless: IS_HEADLESS, channel: 'chrome', args: ctArgs });
          console.log('[CT] Launched system Chrome');
        } catch (e) {
          ctBrowser = await chromium.launch({ headless: IS_HEADLESS, args: ctArgs });
          console.log('[CT] System Chrome not found, using bundled Chromium');
        }
        ctContext = await ctBrowser.newContext({
          userAgent: profile.userAgent,
          viewport: profile.viewport,
          locale: 'en-US',
          timezoneId: 'America/New_York',
          ...(proxyConfig ? { proxy: proxyConfig } : {}),
        });
        await ctContext.addInitScript(STEALTH_SCRIPT);
        try { await ctContext.addCookies(savedCtCookies); } catch (e) {}
        ctPage = await ctContext.newPage();
        // Visit CT homepage to warm up WAF token — use 'load' (not domcontentloaded)
        // so the AWS WAF JS challenge has time to run and set a fresh aws-waf-token.
        try {
          await ctPage.goto(CT_BASE, { waitUntil: 'load', timeout: 30000 });
          await ctPage.waitForTimeout(2000);
        } catch (e) { /* ignore; session check below handles failures */ }

        // Detect hard CloudFront block (expired WAF token or IP ban)
        const ctWafBlocked = await ctPage.evaluate(() => {
          const t = document.body?.innerText || '';
          return t.includes('Generated by cloudfront') || t.includes('Request blocked') || t.includes('403 ERROR');
        }).catch(() => false);

        // Use DOM selector instead of body text — more reliable than text scanning.
        // CT shows #user_profile #username a for the logged-in username.
        const ctLoggedIn = !ctWafBlocked && await ctPage.evaluate(() => {
          return !!(document.querySelector('#user_profile #username a') ||
                    document.querySelector('a[href*="user.asp"]'));
        }).catch(() => false);

        if (!ctLoggedIn) {
          if (ctWafBlocked) console.log('Cellar Tracker: homepage blocked by WAF — re-logging in...');
          // Session expired or WAF blocked. Use the full ctLogin() so we get proper
          // persistent auth cookies (IWine_UserID/IWine_Password), not just session cookies.
          // The in-browser /m/signin form only sets short-lived session cookies that
          // don't persist across browser restarts — hence the save-then-expire loop.
          const ctCred = (options && options.creds) ? options.creds['cellar_tracker'] : null;
          if (ctCred && ctCred.email && ctCred.password) {
            console.log('Cellar Tracker: session expired — running full ctLogin() for persistent cookies...');
            try {
              const reloginResult = await ctLogin(ctCred.email, ctCred.password, userId, proxyConfig);
              if (reloginResult.success && reloginResult.cookies && reloginResult.cookies.length > 0) {
                // Save fresh cookies (includes persistent IWine_UserID/IWine_Password)
                await saveSessionCookies('cellar_tracker', null, null, reloginResult.cookies);
                // Inject into existing context so we can continue without relaunching
                const freshNonPx = reloginResult.cookies.filter(c => !c.name.startsWith('_px'));
                try { await ctContext.addCookies(freshNonPx); } catch (e) {}
                console.log('Cellar Tracker: auto-login successful — persistent cookies saved');
              } else {
                console.log(`Cellar Tracker: auto-login failed (${reloginResult.error}) — please reconnect`);
                ctSessionMissing = true;
              }
            } catch (loginErr) {
              console.log(`Cellar Tracker: auto-login error (${loginErr.message}) — please reconnect`);
              ctSessionMissing = true;
            }
          } else {
            console.log('Cellar Tracker: session expired — please reconnect in the Connections tab');
            ctSessionMissing = true;
          }
        } else {
          // Session is valid — verify the logged-in CT account matches what we stored
          // at connection time to catch any session cross-contamination between users.
          try {
            const expectedCtUser = await pool.query(
              `SELECT account_username FROM users_connections WHERE user_id=$1 AND site_name ILIKE '%cellar%' LIMIT 1`,
              [userId]
            ).then(r => r.rows[0]?.account_username || null).catch(() => null);

            if (expectedCtUser) {
              const actualCtUser = await ctPage.evaluate(() => {
                const a = document.querySelector('#user_profile #username a');
                return a ? a.textContent.trim() : null;
              }).catch(() => null);

              if (actualCtUser && actualCtUser !== expectedCtUser) {
                console.error(`[SECURITY] CT account mismatch for user ${userId}: expected "${expectedCtUser}" got "${actualCtUser}"`);
                await pool.query(
                  `INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1, 'security_error', $2)`,
                  [userId, JSON.stringify({ site: 'cellar_tracker', expected: expectedCtUser, actual: actualCtUser, message: 'Session belongs to wrong CT account' })]
                ).catch(() => {});
                // Invalidate the mismatched session so the next run starts fresh
                await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [userId, 'cellar_tracker']).catch(() => {});
                ctSessionMissing = true;
                console.log('Cellar Tracker: mismatched session invalidated — please reconnect in the Connections tab');
              } else {
                console.log(`Cellar Tracker: session active${actualCtUser ? ` as "${actualCtUser}"` : ''} ✓`);
              }
            } else {
              console.log('Cellar Tracker: session active');
            }
          } catch (e) {
            console.log('Cellar Tracker: session active (identity check skipped)');
          }
        }
      }
    } else {
      console.log(`Skipping Cellar Tracker browser (connected=${ctConnected} enabled=${ctEnabled})`);
    }

    // ── Wine-Searcher browser — only init when WS is connected and enabled ────
    if (wsConnected && wsEnabled) {
      logger('Connecting to Wine Searcher');
      const savedWsCookies = await loadSessionCookies('wine_searcher');

      // Always use a persistent profile so PX fingerprint state is preserved across
      // lookups. Persistent context is the only supported mode — no IS_HEADLESS branch.
      fs.mkdirSync(wsProfileDir, { recursive: true });
      _unlockProfile(wsProfileDir);
      const wsLaunchOpts = {
        headless: IS_HEADLESS,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
        userAgent: profile.userAgent,
        viewport: profile.viewport,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ...(proxyConfig ? { proxy: proxyConfig } : {}),
      };
      try {
        wsContext = await chromium.launchPersistentContext(wsProfileDir, { channel: 'chrome', ...wsLaunchOpts });
        console.log('[WS] Persistent context launched (system Chrome)');
      } catch (e) {
        console.log(`[WS] System Chrome unavailable (${String(e).slice(0, 80)}), using bundled Chromium`);
        wsContext = await chromium.launchPersistentContext(wsProfileDir, wsLaunchOpts);
      }
      await wsContext.addInitScript(STEALTH_SCRIPT);

      if (savedWsCookies && savedWsCookies.length > 0) {
        const nonPxWsCookies = savedWsCookies.filter(c => !c.name.startsWith('_px'));
        try { await wsContext.addCookies(nonPxWsCookies); } catch (e) {}
      }
      const wsPages = wsContext.pages();
      wsPage = wsPages.length > 0 ? wsPages[0] : await wsContext.newPage();

      // ── Pre-lookup: verify session and identity before touching any wine ────
      // Navigate to WS homepage to check auth state. If not logged in, re-login
      // with stored credentials. If logged in, verify the email on the page matches
      // the connection email — catches stale cross-user sessions before any data is read.
      try {
        const _wsConnRow = await pool.query(
          `SELECT email, account_username FROM users_connections WHERE user_id=$1 AND site_name ILIKE '%wine%' LIMIT 1`,
          [userId]
        ).then(r => r.rows[0] || null).catch(() => null);
        const _expectedWsEmail = _wsConnRow?.email || null;

        // Navigate to WS homepage and read the account email element directly.
        // This is more reliable than body-text scanning which varies by page state.
        const EMAIL_SEL = '.page-nav__menu-right .small.text-break, .page-nav__menu-heading .small.text-break';
        let actualWsEmail = null;
        try {
          await wsPage.goto(WS_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await wsPage.waitForTimeout(1500);
          actualWsEmail = await wsPage.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
          }, EMAIL_SEL).catch(() => null);
          console.log(`[WS] Homepage auth check | email=${actualWsEmail || 'not found'}`);
        } catch (e) { console.log('[WS] Homepage navigation failed (non-fatal):', e.message); }

        if (actualWsEmail) {
          // Email found on page — logged in. Verify it matches the DB email for this user.
          if (_expectedWsEmail && actualWsEmail.toLowerCase() !== _expectedWsEmail.toLowerCase()) {
            console.error(`[SECURITY] WS email mismatch for user ${userId}: expected "${_expectedWsEmail}" got "${actualWsEmail}"`);
            await pool.query(
              `INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1, 'security_error', $2)`,
              [userId, JSON.stringify({ site: 'wine_searcher', expected: _expectedWsEmail, actual: actualWsEmail, message: 'Session belongs to wrong WS account' })]
            ).catch(() => {});
            await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [userId, 'wine_searcher']).catch(() => {});
            wsSessionMissing = true;
            wsPage = null;
            console.log('Wine-Searcher: mismatched session invalidated — please reconnect in the Connections tab');
          } else {
            console.log(`Wine-Searcher: session active as "${actualWsEmail}" ✓`);
          }
        } else {
          // Email element not found — not logged in. Attempt in-page re-login.
          console.log('[WS] Not logged in (no email on page) — attempting in-page re-login...');
          const wsCred = options?.creds?.['wine_searcher'];
          if (wsCred && wsCred.email && wsCred.password) {
            try {
              const _wsLogin0 = Date.now(); // used for non-fatal log below
              await wsPage.goto(`${WS_BASE}/signin/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
              await wsPage.waitForTimeout(1000);
              // Check if already redirected to logged-in state
              const afterEmail = await wsPage.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.textContent.trim() : null;
              }, EMAIL_SEL).catch(() => null);
              if (afterEmail) {
                console.log(`[WS] Already logged in after /signin/ redirect as "${afterEmail}" ✓`);
                await saveSessionCookies('wine_searcher', wsContext, 'wine-searcher.com');
              } else {
                const emailSel = 'input[name="email"], input[type="email"], #id_email';
                const passSel  = 'input[name="password"], input[type="password"], #id_password';
                const btnSel   = 'button[type="submit"], input[type="submit"]';
                await wsPage.fill(emailSel, wsCred.email).catch(() => {});
                await wsPage.fill(passSel, wsCred.password).catch(() => {});
                await wsPage.click(btnSel).catch(() => {});
                await wsPage.waitForTimeout(3000);
                const postEmail = await wsPage.evaluate((sel) => {
                  const el = document.querySelector(sel);
                  return el ? el.textContent.trim() : null;
                }, EMAIL_SEL).catch(() => null);
                if (postEmail) {
                  console.log(`[WS] In-page re-login successful (${Date.now()-_wsLogin0}ms) — logged in as "${postEmail}"`);
                  await saveSessionCookies('wine_searcher', wsContext, 'wine-searcher.com');
                } else {
                  console.log(`[WS] In-page re-login did not authenticate (${Date.now()-_wsLogin0}ms) — continuing with injected cookies`);
                }
              }
            } catch (e) {
              console.log(`[WS] In-page re-login error (non-fatal): ${e.message}`);
            }
          } else {
            wsSessionMissing = true;
            console.log('[WS] No saved session and no credentials — skipping WS. Please reconnect in the Connections tab.');
          }
        }
      } catch (e) {
        console.log('[WS] Pre-lookup auth check error (non-fatal):', e.message);
      }
      if (wsPage) {
        await _primeWsLocation(wsPage).catch(e => console.log('[WS] Location prime error (non-fatal):', e.message));
        wsWorldwideConfirmed = true; // skip per-wine modal check for this batch
      }
    } else {
      console.log(`Skipping Wine Searcher browser (connected=${wsConnected} enabled=${wsEnabled})`);
    }

    // ── Process each wine in the batch ─────────────────────────────────────
    logger('Now looking up:');
    let ctPaywalled = false; // set on first CT paywall hit — skips CT for remaining wines
    // Per-batch WS autocomplete slug cache: one in-page fetch per unique wine name,
    // reused across multiple vintages of the same wine in this batch.
    const wsSlugCache = new Map();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      // Human-like pacing between wines (reduced from 1–3s to 0.5–1.2s)
      if (i > 0) {
        const delayMs = 500 + Math.random() * 700;
        if (wsPage) await wsPage.waitForTimeout(delayMs).catch(() => {});
        else if (ctPage) await ctPage.waitForTimeout(delayMs).catch(() => {});
      }
      logger(`Looking up (${i + 1}/${records.length}): ${rec.wine_name}`);
      try {
        const name = rec.wine_name || '';
        const vintage = rec.vintage || '';
        const size = rec.size || '';

        // ── CT and WS run in parallel — cache-first, then live fetch ─────────
        const ctCacheKey = `ct:${name}:${vintage}:${size}`;
        const ctCached = _cacheGet(_ctCache, userId, ctCacheKey);
        const ctPromise = (ctConnected && ctEnabled && ctPage && !ctPaywalled)
          ? (ctCached
              ? (console.log(`[cache] CT hit for "${name}"`), Promise.resolve(ctCached))
              : _ctLookupWithFallback(ctPage, name, vintage, size).then(r => {
                  // Don't cache network/session failures so retries can succeed.
                  if (!r.ct_err || !/page load error|search error/i.test(r.ct_err))
                    _cacheSet(_ctCache, userId, ctCacheKey, r, _CT_TTL);
                  return r;
                }))
          : Promise.resolve({
              ct_matched: null, ct_url: null, ct_data: {},
              ct_err: ctPaywalled
                ? CT_PAYWALL_ERR
                : ctSessionMissing
                  ? 'No saved session — please reconnect in the Connections tab'
                  : (ctConnected ? 'not enabled' : 'no connection'),
            });

        const wsSearchUrl = `${WS_BASE}/find/${encodeURIComponent(name)}/${vintage || 'any'}/-/?Xcurrencycode=${wsCurrency}&Xtax_mode=e&shoptype=1%2C0&Xsavecurrency=Y`;
        const wsCached = _cacheGet(_wsCache, userId, wsSearchUrl);
        const wsPromise = (wsConnected && wsEnabled && wsPage)
          ? (wsCached
              ? (console.log(`[cache] WS hit for "${name}"`), Promise.resolve(wsCached))
              : _wsLookupWithFallback(wsPage, name, vintage, wsCurrency, size, wsSlugCache, wsWorldwideConfirmed).then(r => {
                  // Don't cache session-expired / blocked errors — user may reconnect.
                  if (!r.ws_error || !/session expired|blocked|page load error/i.test(r.ws_error))
                    _cacheSet(_wsCache, userId, wsSearchUrl, r, _WS_TTL);
                  return r;
                }))
          : Promise.resolve({
              ws_error: wsSessionMissing
                ? 'No saved session — please reconnect in the Connections tab'
                : (wsConnected ? 'not enabled' : 'no connection'),
            });

        let [{ ct_matched, ct_url, ct_err, ct_data }, ws_data] = await Promise.all([ctPromise, wsPromise]);

        // CT paywall: account-wide — skip CT for all remaining wines in this batch.
        if (!ctPaywalled && (ct_data?.ct_error === CT_PAYWALL_ERR || ct_err === CT_PAYWALL_ERR)) {
          ctPaywalled = true;
          console.log('[CT] Paywall detected — skipping CT for remaining wines in this batch');
        }
        // Resolve sentinel to user-readable string before saving to DB.
        if (ct_data?.ct_error === CT_PAYWALL_ERR) ct_data.ct_error = 'Cellar Tracker: subscription required to view pricing';
        if (ct_err === CT_PAYWALL_ERR) ct_err = 'Cellar Tracker: subscription required to view pricing';

        // WS PX wipe+retry: profile wipe gives a fresh fingerprint; usually clears PX
        // on the first retry when the initial profile was flagged.
        // Always uses persistent context — no IS_HEADLESS distinction.
        if (ws_data.ws_error === WS_PX_BLOCKED && wsConnected && wsEnabled) {
          console.log('[PX] Profile wipe + context restart for WS lookup...');
          try {
            try { if (wsContext) await wsContext.close(); } catch (e) {}
            wsContext = null; wsPage = null;

            _wipePxProfile(wsProfileDir);
            await new Promise(r => setTimeout(r, 3000));

            _unlockProfile(wsProfileDir);
            const relaunchOpts = {
              headless: IS_HEADLESS,
              args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
              userAgent: profile.userAgent, viewport: profile.viewport,
              locale: 'en-US', timezoneId: 'America/New_York',
              ...(proxyConfig ? { proxy: proxyConfig } : {}),
            };
            try {
              wsContext = await chromium.launchPersistentContext(wsProfileDir, { channel: 'chrome', ...relaunchOpts });
              console.log('[WS] Relaunched with wiped persistent profile');
            } catch (e) {
              console.log('[WS] System Chrome unavailable, using bundled Chromium');
              wsContext = await chromium.launchPersistentContext(wsProfileDir, relaunchOpts);
            }

            await wsContext.addInitScript(STEALTH_SCRIPT);
            const freshWsCookies = await loadSessionCookies('wine_searcher');
            if (freshWsCookies && freshWsCookies.length > 0) {
              const nonPxCookies = freshWsCookies.filter(c => !c.name.startsWith('_px'));
              try { await wsContext.addCookies(nonPxCookies); } catch (e) {}
            }
            const wsPages2 = wsContext.pages();
            wsPage = wsPages2.length > 0 ? wsPages2[0] : await wsContext.newPage();

            ws_data = await _wsLookupWithFallback(wsPage, name, vintage, wsCurrency, size, wsSlugCache, false);

            // Wipe+retry cleared PX — save fresh cookies immediately.
            if (ws_data.ws_error !== WS_PX_BLOCKED) {
              await saveSessionCookies('wine_searcher', wsContext, 'wine-searcher');
            }

            // Still blocked after wipe — credential re-login as last resort.
            if (ws_data.ws_error === WS_PX_BLOCKED) {
              const wsCred = options?.creds?.['wine_searcher'];
              if (wsCred && wsCred.email && wsCred.password) {
                console.log('[WS] PX persists after profile wipe — attempting credential re-login...');
                try {
                  const reloginResult = await wsLogin(wsCred.email, wsCred.password, userId, proxyConfig);
                  if (reloginResult.success && reloginResult.cookies && reloginResult.cookies.length > 0) {
                    await saveSessionCookies('wine_searcher', null, null, reloginResult.cookies);
                    try { if (wsContext) await wsContext.close(); } catch (e) {}
                    wsContext = null; wsPage = null;
                    const wsPages3 = wsContext ? wsContext.pages() : [];
                    try {
                      wsContext = await chromium.launchPersistentContext(wsProfileDir, { channel: 'chrome', ...relaunchOpts });
                    } catch (e) {
                      wsContext = await chromium.launchPersistentContext(wsProfileDir, relaunchOpts);
                    }
                    await wsContext.addInitScript(STEALTH_SCRIPT);
                    const freshNonPx = reloginResult.cookies.filter(c => !c.name.startsWith('_px'));
                    try { await wsContext.addCookies(freshNonPx); } catch (e) {}
                    const rp = wsContext.pages();
                    wsPage = rp.length > 0 ? rp[0] : await wsContext.newPage();
                    ws_data = await _wsLookupWithFallback(wsPage, name, vintage, wsCurrency, size, wsSlugCache, false);
                    if (ws_data.ws_error !== WS_PX_BLOCKED) {
                      await saveSessionCookies('wine_searcher', wsContext, 'wine-searcher');
                      console.log('[WS] Credential re-login successful — session restored');
                    } else {
                      ws_data = { ws_error: 'Wine-Searcher: session expired — please reconnect in the Connections tab' };
                    }
                  } else {
                    console.log(`[WS] Credential re-login failed: ${reloginResult.error || 'unknown error'}`);
                    ws_data = { ws_error: 'Wine-Searcher: session expired — please reconnect in the Connections tab' };
                  }
                } catch (reloginErr) {
                  console.log(`[WS] Credential re-login error: ${String(reloginErr).slice(0, 120)}`);
                  ws_data = { ws_error: 'Wine-Searcher: session expired — please reconnect in the Connections tab' };
                }
              } else {
                ws_data = { ws_error: 'Wine-Searcher: session expired — please reconnect in the Connections tab' };
              }
            }
          } catch (retryErr) {
            console.log('[WS] Wipe+retry failed: ' + String(retryErr).slice(0, 120));
            ws_data = { ws_error: 'Wine-Searcher: blocked by bot-detection — re-login or wait and retry' };
          }
        } else if (ws_data.ws_error === WS_PX_BLOCKED) {
          ws_data = { ws_error: 'Wine-Searcher: session expired — please reconnect in the Connections tab' };
        }

        // status='completed' when prices found OR wine simply wasn't found/priced.
        // status='error' only for genuine failures (network, browser, session, bot-detection).
        const hasCt = !!(ct_data.ct_avg || ct_data.ct_auction);
        const hasWs = !!(ws_data.ws_avg || ws_data.ws_min);
        const ctRealErr = _isRealError(ct_data.ct_error) || _isRealError(ct_err);
        const wsRealErr = _isRealError(ws_data.ws_error);
        const anyRealError = !!(ctRealErr || wsRealErr);
        let status = (hasCt || hasWs) ? 'completed' : (anyRealError ? 'error' : 'completed');

        const update = {
          ct_avg: ct_data.ct_avg || null,
          ct_auction: ct_data.ct_auction || null,
          ct_url: ct_url || null,
          ct_matched: ct_matched || null,
          ct_error: ct_data.ct_error || ct_err || null,
          ws_avg: ws_data.ws_avg || null,
          ws_min: ws_data.ws_min || null,
          ws_url: ws_data.ws_wine_url || null,
          ws_matched: ws_data.ws_matched || null,
          ws_error: ws_data.ws_error || null,
          status,
        };

        // matched_as is the single "Matched As" field shown in the frontend table.
        // Use CT match when available, fall back to WS match.
        const matched_as = update.ct_matched || update.ws_matched || null;
        const ctCurrency = inferCurrencyFromPrice(update.ct_avg || update.ct_auction);
        await pool.query(
          `UPDATE wine_lookups SET
            ct_avg=$1, ct_auction=$2, ct_url=$3, ct_matched=$4, ct_error=$5,
            ws_avg=$6, ws_min=$7, ws_url=$8, ws_matched=$9, ws_error=$10,
            matched_as=$11, status=$12, ws_currency=$13, ct_currency=$14,
            lookup_source='server', updated_date=now()
           WHERE id=$15`,
          [update.ct_avg, update.ct_auction, update.ct_url, update.ct_matched, update.ct_error,
           update.ws_avg, update.ws_min, update.ws_url, update.ws_matched, update.ws_error,
           matched_as, update.status, wsCurrency, ctCurrency, rec.id]
        );
        logger(`Updated ${rec.wine_name}`);
      } catch (err) {
        console.log(`Error for ${rec.wine_name}: ${String(err)}`);
        try { await pool.query('UPDATE wine_lookups SET status=$1, updated_date=now() WHERE id=$2', ['error', rec.id]); } catch (e) {}
      }
    }

    console.log('Finished lookup batch');

    // ── Save session cookies back to DB for future restore ──────────────────
    await saveSessionCookies('cellar_tracker', ctContext, 'cellartracker');
    await saveSessionCookies('wine_searcher', wsContext, 'wine-searcher');
  } catch (err) {
    console.log(`Lookup batch error: ${err}`);
  } finally {
    if (_semAcquired) _releaseSem();
    try { if (ctBrowser) await ctBrowser.close(); } catch (e) {}
    try { if (wsContext) await wsContext.close(); } catch (e) {}
    try { if (_wsBrowserFallback) await _wsBrowserFallback.close(); } catch (e) {}
  }
}

export { runLookupForBatch };
