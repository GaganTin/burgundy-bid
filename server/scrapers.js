import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Activate deep fingerprint evasion in ALL frames (including PX captcha iframes).
// This patches webdriver, iframe src, Chrome app, plugins, and more at the
// browser level — complements the inline STEALTH_SCRIPT below.
chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WS_PROFILES_BASE = path.join(__dirname, '..', '.ws_browser_profiles');
const WS_PROFILE_DIR = path.join(WS_PROFILES_BASE, 'default');

const DIAG_DIR = path.join(process.cwd(), 'server', 'scraper_diagnostics');
try { fs.mkdirSync(DIAG_DIR, { recursive: true }); } catch (e) {}

const CT_BASE = 'https://www.cellartracker.com';
const WS_BASE = 'https://www.wine-searcher.com';

// Match lookup.js: headless on Linux servers without a display, or when explicitly set.
// PLAYWRIGHT_HEADLESS=false explicitly overrides Linux auto-detection (e.g. Xvfb dev).
const IS_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === 'false' ? false :
  (process.env.PLAYWRIGHT_HEADLESS === 'true' ||
   (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY));

// Comprehensive stealth — hides all major Playwright/Chromium automation signals
// that PerimeterX and AWS WAF use for bot detection.
const STEALTH_SCRIPT = `(function(){
  // 1. Webdriver flag — most obvious bot signal
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // 2. Chrome runtime with realistic API shape
  window.chrome = {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    runtime: { id: undefined, connect: function(){}, sendMessage: function(){}, onMessage: { addListener: function(){} } },
    loadTimes: function(){ return { firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', requestTime: Date.now()/1000, startLoadTime: Date.now()/1000, commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, connectionInfo: 'http/1.1', npnNegotiatedProtocol: 'unknown', wasNpnNegotiated: false, wasFetchedViaSpdy: false }; },
    csi: function(){ return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 }; }
  };

  // 3. Languages, hardware, platform
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

  // 4. Realistic plugin list (empty array is a headless signal)
  try {
    const fakePlugins = ['Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client'].map(function(name) {
      return { name: name, description: '', filename: name.toLowerCase().replace(/ /g,'-'), length: 0, item: function(){return null;}, namedItem: function(){return null;} };
    });
    fakePlugins.length = 3;
    Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
  } catch(e) {}

  // 5. Permissions API — notifications check is a common detection pattern
  if (window.Permissions && window.Permissions.prototype) {
    var origQuery = window.Permissions.prototype.query;
    window.Permissions.prototype.query = function(p) {
      return p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery.apply(this, arguments);
    };
  }

  // 6. WebGL — spoof GPU vendor/renderer (fingerprinting signal)
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

  // 7. Canvas noise — breaks canvas fingerprinting without causing visible changes
  try {
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === 'image/png' && this.width > 16 && this.height > 16) {
        var ctx = this.getContext('2d');
        if (ctx) {
          var px = ctx.getImageData(0, 0, 1, 1);
          px.data[0] = (px.data[0] + 1) % 256;
          ctx.putImageData(px, 0, 0);
        }
      }
      return origToDataURL.apply(this, arguments);
    };
  } catch(e) {}

  // 8. Connection info
  try {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false })
    });
  } catch(e) {}

  // 9. Screen dimensions (match viewport)
  try { Object.defineProperty(screen, 'colorDepth', { get: () => 24 }); } catch(e) {}
  try { Object.defineProperty(screen, 'pixelDepth', { get: () => 24 }); } catch(e) {}
})();`;

const PX_SIGNALS = ['press & hold', 'px-captcha', 'access to this page has been denied', 'perimeterx', 'px-cloud.net'];
export const WS_AUTH_SIGNALS = ['logout', 'sign out', 'sign-out', 'signout', 'my account', 'my profile', 'my wines', '/my/', 'pro member', 'pro account'];

// ── Helpers ─────────────────────────────────────────────────────────────────

async function _saveDiag(page, tag) {
  try {
    const ts = Date.now();
    await page.screenshot({ path: path.join(DIAG_DIR, `${tag}_${ts}.png`), fullPage: true });
    await fs.promises.writeFile(path.join(DIAG_DIR, `${tag}_${ts}.html`), await page.content(), 'utf8');
  } catch (e) {}
}

async function _extractCookies(context, domainFilter) {
  try {
    const all = await context.cookies();
    return all.filter(c => (c.domain || '').includes(domainFilter) || c.name.startsWith('_px'));
  } catch (e) { return []; }
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
    // Ease in-out cubic: slow at start/end, fast in middle
    const e = t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    const x = Math.pow(1-e,3)*startX + 3*Math.pow(1-e,2)*e*cp1x + 3*(1-e)*Math.pow(e,2)*cp2x + Math.pow(e,3)*targetX;
    const y = Math.pow(1-e,3)*startY + 3*Math.pow(1-e,2)*e*cp1y + 3*(1-e)*Math.pow(e,2)*cp2y + Math.pow(e,3)*targetY;
    await page.mouse.move(x, y);
    // Variable delay: slower at edges (natural human acceleration), faster in middle
    const delay = 6 + Math.sin(Math.PI * t) * 14 + Math.random() * 7;
    await page.waitForTimeout(delay);
  }
}


// Find the PX button locator AND frame — for frame-aware interaction.
async function _findPxButtonLocator(page) {
  // First: look inside all frames for the real iframe-based challenge button
  for (const frame of page.frames()) {
    try {
      // Wait a moment for captcha.js to render the button inside the iframe
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

// Wait for user to manually complete login in the visible (headed) browser window.
// Returns 'logged_in' if WS auth detected, 'px_cleared' if PX gone but not yet logged in, null if timed out.
async function _waitForManualLogin(page, maxWaitMs = 180000) {
  // Bring browser window to front so user can see it
  try { await page.bringToFront(); } catch (e) {}
  console.log('[WS] *** MANUAL LOGIN REQUIRED ***');
  console.log('[WS] Please look at the Chrome browser window that just opened and:');
  console.log('[WS]   1. Press & Hold the button if a captcha is showing');
  console.log('[WS]   2. Log in with your Wine Searcher Pro credentials');
  console.log('[WS] Waiting up to ' + Math.round(maxWaitMs / 1000) + 's...');
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      if (typeof page.isClosed === 'function' && page.isClosed()) break;
      const inner = ((await page.evaluate(() => document.body && document.body.innerText)) || '').toLowerCase();
      const html = (await page.content()).toLowerCase();
      const combined = inner + ' ' + html;
      if (WS_AUTH_SIGNALS.some(k => combined.includes(k))) {
        console.log('[WS] Manual login detected — user is authenticated!');
        return 'logged_in';
      }
      if (!PX_SIGNALS.some(sig => combined.includes(sig))) {
        console.log('[WS] PX cleared manually!');
        return 'px_cleared';
      }
      await page.waitForTimeout(2000);
    } catch (e) { break; }
  }
  console.log('[WS] Manual login window timed out.');
  return null;
}

async function _extractWsDisplayName(page) {
  try {
    return await page.evaluate(() => {
      const sel = '.page-nav__open-menu-right .d-none.d-lg-inline, .page-nav__menu-right .d-none.d-lg-inline';
      const span = document.querySelector(sel);
      return span ? span.textContent.trim() : null;
    });
  } catch (e) { return null; }
}

async function _extractWsEmail(page) {
  try {
    return await page.evaluate(() => {
      const el = document.querySelector(
        '.page-nav__menu-right .small.text-break, .page-nav__menu-heading .small.text-break'
      );
      return el ? el.textContent.trim() : null;
    });
  } catch (e) { return null; }
}

// Wipe Chromium session data to get a fresh PX fingerprint on retry.
// Removes cookies, local/session storage, IndexedDB and cache.
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

// ── Cellar Tracker Login ──────────────────────────────────────────────────────

async function ctLogin(username, password, userId = null, proxyConfig = null) {
  if (!username || !password) return { success: false, error: 'Email and password are required' };

  // On a server (IS_HEADLESS), require a proxy — the server's datacenter IP is
  // blocked by CT's AWS WAF, which silently drops connections (ERR_EMPTY_RESPONSE).
  if (IS_HEADLESS && !proxyConfig) {
    return { success: false, error: 'Server-mode connection requires a residential proxy. Ensure the proxy service is configured and has available capacity, then try again.' };
  }

  let browser;
  let context;
  let page;
  try {
    // Proxy at browser launch level (not just context) so every Chrome connection —
    // including the initial TLS handshake — goes through the residential IP.
    browser = await chromium.launch({
      headless: IS_HEADLESS,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    await context.addInitScript(STEALTH_SCRIPT);
    page = await context.newPage();

    // Step 1: Visit homepage — solves AWS WAF JS challenge (sets aws-waf-token cookie).
    // Retry once: residential proxies occasionally return ERR_EMPTY_RESPONSE transiently.
    try {
      await page.goto(CT_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navErr) {
      if (/ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i.test(String(navErr))) {
        await page.waitForTimeout(3000);
        await page.goto(CT_BASE, { waitUntil: 'domcontentloaded', timeout: 40000 });
      } else {
        throw navErr;
      }
    }
    await page.waitForTimeout(2500);

    // If already logged in — logout first so we always authenticate with exactly
    // the provided credentials. A stale session could belong to another user.
    const homeBodyText = ((await page.evaluate(() => document.body?.innerText).catch(() => '')) || '').toLowerCase();
    const ctAlreadyLoggedIn = homeBodyText.includes('sign out') || homeBodyText.includes('logout') ||
      homeBodyText.includes('my cellar') || homeBodyText.includes('my wines');
    if (ctAlreadyLoggedIn) {
      console.log('[CT] Already logged in — logging out first for clean authentication...');
      try {
        await page.goto(CT_BASE + '/flushcookie.asp?Redir=default.asp', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        console.log('[CT] Logged out successfully');
      } catch (e) {
        console.log('[CT] Logout navigation failed (non-fatal):', e.message);
      }
    }

    // Step 2: Navigate to mobile sign-in (AJAX login — URL stays at /m/signin after success)
    await page.goto(CT_BASE + '/m/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Step 3: Wait for the sign-in form
    const userSel = 'input[name="User"]';
    const passSel = 'input[name="Password"]';
    try {
      await page.waitForSelector(userSel, { timeout: 12000 });
    } catch (e) {
      await _saveDiag(page, 'ct_signin_missing');
      await context.close(); await browser.close();
      return { success: false, error: 'Login form not found — CT may have changed their page.' };
    }

    // Step 4: Fill credentials with human-like delays
    await page.fill(userSel, '');
    await page.waitForTimeout(200);
    await page.type(userSel, username, { delay: 60 + Math.random() * 60 });
    await page.waitForTimeout(300 + Math.random() * 200);
    await page.fill(passSel, '');
    await page.waitForTimeout(150);
    await page.type(passSel, password, { delay: 60 + Math.random() * 60 });
    await page.waitForTimeout(400 + Math.random() * 300);

    // Step 5: Submit — CT mobile uses AJAX (networkidle may never fire, use load+timeout)
    await page.click('input[type="submit"], button[type="submit"]');
    try { await page.waitForLoadState('load', { timeout: 15000 }); } catch (e) {}
    await page.waitForTimeout(2000);

    // Step 6: Check result.
    // CT mobile AJAX login does NOT navigate away from /m/signin.
    // Success is indicated by:
    //   (a) html element gets class "authenticated"
    //   (b) "sign out" link appears in the page
    //   (c) known CT user-panel content appears
    const htmlClass = ((await page.evaluate(() => document.documentElement.className)) || '').toLowerCase();
    const bodyText = ((await page.evaluate(() => document.body.innerText)) || '').toLowerCase();
    const pageUrl = page.url().toLowerCase();

    const isAuthenticated = htmlClass.includes('authenticated');
    const hasSignOut = bodyText.includes('sign out') || bodyText.includes('logout') || bodyText.includes('signout');
    const navigatedAway = !pageUrl.includes('/signin') && !pageUrl.includes('/login');
    const hasMyContent = bodyText.includes('my cellar') || bodyText.includes('my wines') || bodyText.includes('my notes');

    if (isAuthenticated || hasSignOut || (navigatedAway && hasMyContent)) {
      // Extract CT username for account verification.
      // Strategy 1: read from current page (authenticated mobile page has it)
      // Strategy 2: navigate to CT homepage (full desktop UI)
      // Strategy 3: call CT JSON API
      let username = null;
      try {
        // Strategy 1: read from current page (works on desktop CT pages)
        username = await page.evaluate(() => {
          const a = document.querySelector('#user_profile #username a, .username a, a[href*="user.asp"]');
          return a ? a.textContent.trim() : null;
        }).catch(() => null);
        if (username) console.log('[CT] username via Strategy 1:', username);

        if (!username) {
          // Strategy 2: use CT JSON API (most reliable — works regardless of current page)
          const resp = await page.goto(`${CT_BASE}/api.asp?q=getuser&format=json`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
          if (resp && resp.ok()) {
            const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
            try {
              const data = JSON.parse(txt);
              // API may return array [{User:...}] or object {User:...}
              username = (Array.isArray(data) ? data[0] : data)?.User || null;
              if (!username) {
                // try other known fields
                const obj = Array.isArray(data) ? data[0] : data;
                username = obj?.Username || obj?.username || obj?.Name || obj?.name || null;
              }
            } catch { /* not JSON */ }
          }
          if (username) console.log('[CT] username via Strategy 2 (API):', username);
        }

        if (!username) {
          // Strategy 3: navigate to desktop CT homepage and wait for #user_profile to render
          await page.goto(CT_BASE, { waitUntil: 'load', timeout: 30000 });
          try {
            await page.waitForSelector('#user_profile #username a', { timeout: 10000 });
          } catch { /* timeout — element may not appear */ }
          username = await page.evaluate(() => {
            const a = document.querySelector('#user_profile #username a');
            return a ? a.textContent.trim() : null;
          }).catch(() => null);
          if (username) console.log('[CT] username via Strategy 3 (homepage):', username);
        }

        if (!username) {
          // Strategy 4: CT user profile page
          const resp = await page.goto(`${CT_BASE}/list.asp?Table=User`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
          if (resp) {
            username = await page.evaluate(() => {
              const a = document.querySelector('#user_profile #username a, h1.username, .profile-username');
              return a ? a.textContent.trim() : null;
            }).catch(() => null);
          }
          if (username) console.log('[CT] username via Strategy 4 (profile page):', username);
        }

        console.log('[CT] final username:', username);
      } catch (e) {
        console.log('[CT] username extraction error (non-fatal):', e.message);
      }

      // Extract email + member name from editprofile.asp for identity verification.
      // This is the ground-truth account email stored by CT.
      let accountEmail = null;
      try {
        await page.goto(CT_BASE + '/editprofile.asp', { waitUntil: 'domcontentloaded', timeout: 20000 });
        accountEmail = await page.evaluate(() => {
          const el = document.querySelector('input#email_address');
          return el ? el.value.trim() : null;
        }).catch(() => null);
        if (!username) {
          username = await page.evaluate(() => {
            const el = document.querySelector('input#member_name');
            return el ? el.value.trim() : null;
          }).catch(() => null);
        }
        if (accountEmail) console.log('[CT] account email extracted from editprofile.asp');
      } catch (e) {
        console.log('[CT] editprofile.asp extraction error (non-fatal):', e.message);
      }

      const cookies = await _extractCookies(context, 'cellartracker');
      await context.close(); await browser.close();
      return { success: true, cookies, username, email: accountEmail };
    }

    // Check for explicit error text
    const hasError = ['incorrect', 'invalid', 'wrong password', 'bad username', 'please try again', 'not found'].some(x => bodyText.includes(x));
    await _saveDiag(page, 'ct_login_result');
    await context.close(); await browser.close();
    return { success: false, error: hasError ? 'Login failed — wrong credentials.' : 'Login failed — could not verify session.' };
  } catch (err) {
    try { if (browser) await browser.close(); } catch (e) {}
    return { success: false, error: `Browser error – ${err}` };
  }
}

// ── Wine-Searcher Login ──────────────────────────────────────────────────────

async function wsLogin(username, password, userId = null, proxyConfig = null) {
  if (!username || !password) return { success: false, error: 'Email and password are required.' };

  const profileDir = userId
    ? path.join(WS_PROFILES_BASE, String(userId), 'wine_searcher')
    : WS_PROFILE_DIR;

  try { fs.mkdirSync(profileDir, { recursive: true }); } catch (e) {}

  return _wsLoginAttempt(username, password, profileDir, proxyConfig);
}

async function _wsLoginAttempt(username, password, profileDir, proxyConfig = null) {
  let context;
  let page;

  // On a server (IS_HEADLESS), require a proxy — WS uses PerimeterX which aggressively
  // blocks datacenter IPs. Without a residential proxy, the login will hit PX immediately.
  if (IS_HEADLESS && !proxyConfig) {
    return { success: false, error: 'Server-mode connection requires a residential proxy. Ensure the proxy service is configured and has available capacity, then try again.' };
  }

  async function safeClose() {
    try { if (context) await context.close(); } catch (e) {}
  }

  try {
    const LAUNCH_OPTS = {
      headless: IS_HEADLESS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized',
      ],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ignoreHTTPSErrors: true,
      ...(proxyConfig ? { proxy: proxyConfig } : {}),
    };
    // Prefer system Chrome (better PX fingerprint than bundled Chromium)
    try {
      context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', ...LAUNCH_OPTS });
      console.log('[WS] Launched with system Chrome');
    } catch (e) {
      console.log('[WS] System Chrome unavailable, using bundled Chromium');
      context = await chromium.launchPersistentContext(profileDir, LAUNCH_OPTS);
    }
    await context.addInitScript(STEALTH_SCRIPT);

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();

    // Step 1: Visit homepage — PX fingerprints the browser here.
    // Retry once on transient proxy errors (ERR_EMPTY_RESPONSE).
    try {
      await page.goto(WS_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (navErr) {
      if (/ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i.test(String(navErr))) {
        await page.waitForTimeout(4000);
        await page.goto(WS_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } else {
        throw navErr;
      }
    }
    // Wait for any post-load redirects (e.g. geo-based) to settle before reading content.
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) {}
    await page.waitForTimeout(2000);

    // Wrap content reads: "page is navigating" can still fire transiently.
    async function safeContent() {
      for (let i = 0; i < 3; i++) {
        try { return (await page.content()).toLowerCase(); } catch (e) {
          if (i < 2) await page.waitForTimeout(2000); else return '';
        }
      }
      return '';
    }
    async function safeInnerText() {
      for (let i = 0; i < 3; i++) {
        try { return ((await page.evaluate(() => document.body?.innerText)) || '').toLowerCase(); } catch (e) {
          if (i < 2) await page.waitForTimeout(2000); else return '';
        }
      }
      return '';
    }

    const homeHtml = await safeContent();
    const homeInner = await safeInnerText();
    const homeText = homeHtml + ' ' + homeInner;

    // Already authenticated from a saved profile session — logout first so we
    // always authenticate with exactly the provided credentials. A lingering
    // session could belong to another user or have stale permissions.
    if (WS_AUTH_SIGNALS.some(k => homeText.includes(k))) {
      console.log('[WS] Already logged in — logging out first for clean authentication...');
      try {
        await page.goto(WS_BASE + '/prof/logout', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);
        console.log('[WS] Logged out successfully');
      } catch (e) {
        console.log('[WS] Logout navigation failed (non-fatal):', e.message);
      }
    }

    // PX block detected on homepage — auto attempt, then wipe+retry, then manual fallback
    if (PX_SIGNALS.some(sig => homeText.includes(sig))) {
      console.log('[WS] PX detected on homepage, attempting behavioral solve...');
      let autoSolved = await _solvePxCaptcha(page);

      // If auto-solve fails, wipe the profile (clear stale fingerprint data that PX flagged)
      // and retry once with a fresh session — gives us a clean risk score.
      if (!autoSolved) {
        console.log('[WS] Auto-solve attempt 1 failed. Wiping profile for fresh fingerprint...');
        await safeClose();
        _wipePxProfile(profileDir);
        await new Promise(r => setTimeout(r, 3000));

        // Re-launch with wiped profile
        try {
          context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', ...LAUNCH_OPTS });
        } catch (_e) {
          context = await chromium.launchPersistentContext(profileDir, LAUNCH_OPTS);
        }
        await context.addInitScript(STEALTH_SCRIPT);
        const newPages = context.pages();
        page = newPages.length > 0 ? newPages[0] : await context.newPage();

        try {
          await page.goto(WS_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (navErr) {
          if (/ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET/i.test(String(navErr))) {
            await page.waitForTimeout(4000);
            await page.goto(WS_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
          } else { throw navErr; }
        }
        try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (e) {}
        await page.waitForTimeout(2000);

        const retryText = (await safeContent()) + ' ' + (await safeInnerText());
        if (WS_AUTH_SIGNALS.some(k => retryText.includes(k))) {
          const displayName = await _extractWsDisplayName(page);
          const email = await _extractWsEmail(page);
          const cookies = await _extractCookies(context, 'wine-searcher');
          await safeClose();
          return { success: true, cookies, displayName, email };
        }
        if (PX_SIGNALS.some(sig => retryText.includes(sig))) {
          console.log('[WS] PX still present after profile wipe. Attempting solve on fresh profile...');
          autoSolved = await _solvePxCaptcha(page);
        }
      }

      if (!autoSolved) {
        // Auto solve failed — open manual window (user sees the browser and can interact)
        const manualResult = await _waitForManualLogin(page, 180000);
        if (manualResult === 'logged_in') {
          const displayName = await _extractWsDisplayName(page);
          const cookies = await _extractCookies(context, 'wine-searcher');
          await safeClose();
          return { success: true, cookies, displayName };
        }
        if (!manualResult) {
          await _saveDiag(page, 'ws_home_blocked');
          await safeClose();
          return { success: false, error: 'Wine-Searcher: captcha could not be bypassed. Try connecting again and complete the verification in the browser window.' };
        }
        // manualResult === 'px_cleared' — fall through to login form
      }
      // After solve, re-check if already logged in
      const postSolveText = await safeInnerText();
      if (WS_AUTH_SIGNALS.some(k => postSolveText.includes(k))) {
        const displayName = await _extractWsDisplayName(page);
        const email = await _extractWsEmail(page);
        const cookies = await _extractCookies(context, 'wine-searcher');
        await safeClose();
        return { success: true, cookies, displayName, email };
      }
    }

    // Step 2: Dismiss cookie-consent banner
    try {
      const consent = page.locator('a.cookie-accept, a:has-text("Accept & Continue"), button:has-text("Accept & Continue"), button:has-text("Accept")');
      if (await consent.count() > 0) {
        const first = consent.first();
        if (await first.isVisible({ timeout: 2000 }).catch(() => false)) {
          await first.click();
          await page.waitForTimeout(600);
        }
      }
    } catch (e) {}

    // Step 3: Navigate to sign-in page
    // Try to extract the sign-in URL from nav first (avoids extra click)
    let signInUrl = null;
    try {
      await page.locator('text=Sign In').first().click({ timeout: 8000 });
      await page.waitForTimeout(800);
      signInUrl = await page.evaluate(() => {
        for (const a of document.querySelectorAll('a')) {
          const t = (a.textContent || '').trim();
          if (t === 'Sign in' || t === 'Log in' || t === 'Login' || t === 'Sign In') return a.href || null;
        }
        return null;
      });
    } catch (e) {}

    if (signInUrl && signInUrl.startsWith('http')) {
      await page.goto(signInUrl, { waitUntil: 'load', timeout: 90000 });
    } else {
      await page.goto(WS_BASE + '/sign-in', { waitUntil: 'load', timeout: 90000 });
    }
    await page.waitForTimeout(3000);

    // Step 4: Check for PX on the login page
    const loginHtml = await safeContent();
    const loginInner = await safeInnerText();
    if (PX_SIGNALS.some(sig => (loginHtml + ' ' + loginInner).includes(sig))) {
      console.log('[WS] PX detected on login page, attempting behavioral solve...');
      const autoSolvedLogin = await _solvePxCaptcha(page);
      if (!autoSolvedLogin) {
        const manualLogin = await _waitForManualLogin(page, 180000);
        if (manualLogin === 'logged_in') {
          const displayName = await _extractWsDisplayName(page);
          const email = await _extractWsEmail(page);
          const cookies = await _extractCookies(context, 'wine-searcher');
          await safeClose();
          return { success: true, cookies, displayName, email };
        }
        if (!manualLogin) {
          await _saveDiag(page, 'ws_login_blocked');
          await safeClose();
          return { success: false, error: 'Wine-Searcher: captcha could not be bypassed. Try connecting again and complete the verification in the browser window.' };
        }
      }
    }

    // Step 5: Find and fill credentials
    const EMAIL_SEL = '#loginmodel-username, input[name="LoginModel[username]"], input[type="email"]';
    const PASS_SEL = '#loginmodel-password, input[name="LoginModel[password]"], input[type="password"]';

    let foundLogin = false;
    try {
      await page.waitForSelector(EMAIL_SEL, { timeout: 12000, state: 'visible' });
      foundLogin = true;
    } catch (e) {}

    if (!foundLogin) {
      await _saveDiag(page, 'ws_login_missing');
      await safeClose();
      return { success: false, error: 'Wine-Searcher: login form not found.' };
    }

    await page.fill(EMAIL_SEL, '');
    await page.waitForTimeout(200);
    await page.type(EMAIL_SEL, username, { delay: 55 + Math.random() * 55 });
    await page.waitForTimeout(350 + Math.random() * 300);
    await page.fill(PASS_SEL, '');
    await page.waitForTimeout(150);
    await page.type(PASS_SEL, password, { delay: 55 + Math.random() * 55 });
    await page.waitForTimeout(400 + Math.random() * 400);

    // Step 6: Submit — target login button specifically (not Google/Apple)
    await page.click('button[name="login-button"], button#pv_submit_F, button[type="submit"]:not([name*="google"]):not([name*="apple"])');
    try { await page.waitForLoadState('load', { timeout: 30000 }); } catch (e) {}
    await page.waitForTimeout(3000);

    // Step 7: Check result
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (e) {}
    const postHtml = await safeContent();
    const postInner = await safeInnerText();
    const postUrl = page.url().toLowerCase();

    if (WS_AUTH_SIGNALS.some(k => (postHtml + ' ' + postInner).includes(k))) {
      const displayName = await _extractWsDisplayName(page);
      const email = await _extractWsEmail(page);
      const cookies = await _extractCookies(context, 'wine-searcher');
      await safeClose();
      return { success: true, cookies, displayName, email };
    }

    // Check for credential error element
    try {
      const errHandle = await page.$('div.badge-magnum p.redtxt') || await page.$('div.badge-magnum');
      if (errHandle) {
        let errMsg = null;
        try { errMsg = (await page.evaluate(el => el.innerText, errHandle)).trim(); } catch (e) {}
        await safeClose();
        return { success: false, error: errMsg || 'Login failed — wrong credentials.' };
      }
    } catch (e) {}

    // Fallback: if no longer on login page and no visible error, treat as success
    const onLoginPage = ['login', 'signin', 'sign-in'].some(x => postUrl.includes(x));
    const hasError = ['invalid', 'incorrect', 'wrong password', 'not found', 'please try again'].some(x => postInner.includes(x));
    if (!onLoginPage && !hasError) {
      const displayName = await _extractWsDisplayName(page);
      const email = await _extractWsEmail(page);
      const cookies = await _extractCookies(context, 'wine-searcher');
      await safeClose();
      return { success: true, cookies, displayName, email };
    }

    await _saveDiag(page, 'ws_login_result');
    await safeClose();
    return { success: false, error: 'Login failed — wrong credentials.' };
  } catch (err) {
    try { if (context) await context.close(); } catch (e) {}
    return { success: false, error: `Browser error – ${String(err)}` };
  }
}

export { ctLogin, wsLogin };
