const { chromium } = require('playwright');
const path = require('path');

const BASE   = 'http://localhost:5299';
const ASSETS = path.join(__dirname, 'src/assets/guide');
const TOKEN  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNmODg5YzgzLTJhZDUtNDljZS04MzBjLWE2MzgyYjQxMTEzYyIsImVtYWlsIjoic2NyZWVuc2hvdF90ZXN0QGJ1cmd1bmR5YmlkLmNvbSIsInJvbGVfdHlwZSI6InVzZXIiLCJpYXQiOjE3NzY1ODY2ODMsImV4cCI6MTc3NjU5MDI4M30.bmF__NRpNiQQacD1YYXn1blHxF_wbLyJ4cNQT7T9uVk';
const USER   = JSON.stringify({ id: 'cf889c83-2ad5-49ce-830c-a6382b41113c', full_name: 'User', email: 'screenshot_test@burgundybid.com', role_type: 'user', subscription_plan: 'free', preferred_theme: 'light' });

const BOTH_ONE_ENABLED = [
  { id: 'a1', site_name: 'cellar_tracker', is_connected: true, status: 'connected', is_enabled: true,  email: 'user@example.com', updated_date: new Date().toISOString() },
  { id: 'a2', site_name: 'wine_searcher',  is_connected: true, status: 'connected', is_enabled: false, email: 'user@example.com', updated_date: new Date().toISOString() },
];
const BOTH_ENABLED = [
  { id: 'a1', site_name: 'cellar_tracker', is_connected: true, status: 'connected', is_enabled: true, email: 'user@example.com', updated_date: new Date().toISOString() },
  { id: 'a2', site_name: 'wine_searcher',  is_connected: true, status: 'connected', is_enabled: true, email: 'user@example.com', updated_date: new Date().toISOString() },
];

async function makePage(browser, creds, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('app_access_token', t);
    localStorage.setItem('app_current_user', u);
  }, [TOKEN, USER]);
  await ctx.route('**/entities/SiteCredential**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(creds) }));
  await ctx.route('**/subscription/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ used: 1, limit: 150, remaining: 149, plan: 'pro' }) }));
  await ctx.route('**/batches/history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/batches**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: null, history: [] }) }));
  const page = await ctx.newPage();
  if (opts.extension) {
    await page.addInitScript((incog) => {
      window.__BURGUNDY_EXTENSION_INSTALLED__ = true;
      document.documentElement.dataset.bbExtension = 'true';
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'BB_CHECK_INCOGNITO' || e.data?.type === 'BB_EXTENSION_INCOGNITO_CHECK') {
          window.postMessage({ type: 'BB_EXTENSION_INCOGNITO_RESULT', requestId: e.data?.requestId, allowed: incog }, '*');
        }
      });
    }, opts.incognito === true);
  }
  return { page, ctx };
}

async function load(page, pagePath) {
  await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

async function shot(page, file, clip) {
  const opts = { path: `${ASSETS}/${file}` };
  if (clip) opts.clip = clip;
  await page.screenshot(opts);
  console.log('  done:', file);
}

async function step2Clip(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    const p = ps.find(el => el.textContent.trim().startsWith('Step 2'));
    if (!p) return null;
    let el = p.parentElement;
    for (let i = 0; i < 6; i++) {
      const r = el.getBoundingClientRect();
      if (r.width > 500 && r.height > 150) return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 560) };
      el = el.parentElement;
    }
    return null;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log('Browser ready\n');

  // 1. conn-full.png
  console.log('1. conn-full.png');
  { const { page, ctx } = await makePage(browser, []);
    await load(page, '/Connections');
    await shot(page, 'conn-full.png'); await ctx.close(); }

  // 2. conn-ext-card.png  Step 1 section only
  console.log('2. conn-ext-card.png');
  { const { page, ctx } = await makePage(browser, []);
    await load(page, '/Connections');
    const clip = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('p'));
      const p = ps.find(el => el.textContent.trim().startsWith('Step 1'));
      if (!p) return null;
      let el = p.parentElement;
      for (let i = 0; i < 6; i++) {
        const r = el.getBoundingClientRect();
        if (r.width > 500 && r.height > 150) return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 520) };
        el = el.parentElement;
      }
      return null;
    });
    await shot(page, 'conn-ext-card.png', clip ? { x: Math.max(0,clip.x-8), y: Math.max(0,clip.y-8), width: clip.width+16, height: clip.height+16 } : null);
    await ctx.close(); }

  // 3. conn-incognito-step.png  Extension installed, incognito NOT allowed
  console.log('3. conn-incognito-step.png');
  { const { page, ctx } = await makePage(browser, [], { extension: true, incognito: false });
    await load(page, '/Connections');
    await page.waitForTimeout(1800);
    const clip = await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('p'));
      const p = ps.find(el => el.textContent.trim().startsWith('Step 1'));
      if (!p) return null;
      let el = p.parentElement;
      for (let i = 0; i < 6; i++) {
        const r = el.getBoundingClientRect();
        if (r.width > 500 && r.height > 150) return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height+80, 620) };
        el = el.parentElement;
      }
      return null;
    });
    await shot(page, 'conn-incognito-step.png', clip ? { x: Math.max(0,clip.x-8), y: Math.max(0,clip.y-8), width: clip.width+16, height: clip.height+16 } : null);
    await ctx.close(); }

  // 4. conn-data-cards.png  Step 2 no connections
  console.log('4. conn-data-cards.png');
  { const { page, ctx } = await makePage(browser, []);
    await load(page, '/Connections');
    const clip = await step2Clip(page);
    await shot(page, 'conn-data-cards.png', clip ? { x: Math.max(0,clip.x-8), y: Math.max(0,clip.y-8), width: clip.width+16, height: clip.height+16 } : null);
    await ctx.close(); }

  // 5. conn-connected-cards.png  Both connected, one enabled
  console.log('5. conn-connected-cards.png');
  { const { page, ctx } = await makePage(browser, BOTH_ONE_ENABLED);
    await load(page, '/Connections');
    const clip = await step2Clip(page);
    await shot(page, 'conn-connected-cards.png', clip ? { x: Math.max(0,clip.x-8), y: Math.max(0,clip.y-8), width: clip.width+16, height: clip.height+16 } : null);
    await ctx.close(); }

  // 6. conn-connected.png  Extension + both enabled — full page
  console.log('6. conn-connected.png');
  { const { page, ctx } = await makePage(browser, BOTH_ENABLED, { extension: true, incognito: true });
    await load(page, '/Connections');
    await page.waitForTimeout(1800);
    await shot(page, 'conn-connected.png'); await ctx.close(); }

  // 7. lookup-full.png  Extension + both connections + lookup UI
  console.log('7. lookup-full.png');
  { const { page, ctx } = await makePage(browser, BOTH_ENABLED, { extension: true, incognito: true });
    await load(page, '/Lookup');
    await page.waitForTimeout(1800);
    await shot(page, 'lookup-full.png'); await ctx.close(); }

  // 8. lookup-server-mode.png  No extension, CT only
  console.log('8. lookup-server-mode.png');
  { const { page, ctx } = await makePage(browser, [
      { id: 'a1', site_name: 'cellar_tracker', is_connected: true, status: 'connected', is_enabled: true, email: 'user@example.com', updated_date: new Date().toISOString() }
    ]);
    await load(page, '/Lookup');
    await shot(page, 'lookup-server-mode.png'); await ctx.close(); }

  // 9. lookup-ext-mode.png  Extension + both, incognito
  console.log('9. lookup-ext-mode.png');
  { const { page, ctx } = await makePage(browser, BOTH_ENABLED, { extension: true, incognito: true });
    await load(page, '/Lookup');
    await page.waitForTimeout(1800);
    await shot(page, 'lookup-ext-mode.png'); await ctx.close(); }

  // 10. lookup-paste.png  Paste List tab + WS currency visible
  console.log('10. lookup-paste.png');
  { const { page, ctx } = await makePage(browser, BOTH_ENABLED, { extension: true, incognito: true });
    await load(page, '/Lookup');
    await page.locator('button', { hasText: 'Paste List' }).click().catch(() => {});
    await page.waitForTimeout(700);
    const clip = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(b => b.textContent.trim() === 'Single Search');
      if (!b) return null;
      let el = b.parentElement;
      for (let i = 0; i < 8; i++) {
        const r = el.getBoundingClientRect();
        if (r.width > 500 && r.height > 200) return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 500) };
        el = el.parentElement;
      }
      return null;
    });
    await shot(page, 'lookup-paste.png', clip ? { x: Math.max(0,clip.x-8), y: Math.max(0,clip.y-8), width: clip.width+16, height: clip.height+16 } : null);
    await ctx.close(); }

  // 11. lookup-results-table.png  Mocked results with Done status
  console.log('11. lookup-results-table.png');
  { const BID = 'batch_mock_001';
    const WINES = [
      { id:'w1', batch_id:BID, tab:'single', wine_name:'2019 Penfolds Grange Bin 95',    vintage:'2019', status:'done', ct_avg_value:850,  ct_auction_avg:820,  ws_avg_price:890,  ws_min_price:810,  ws_currency:'USD', matched_as:'2019 Penfolds Grange Bin 95',    offer:null, created_date:new Date().toISOString() },
      { id:'w2', batch_id:BID, tab:'single', wine_name:'2018 Opus One Napa Valley',     vintage:'2018', status:'done', ct_avg_value:420,  ct_auction_avg:400,  ws_avg_price:450,  ws_min_price:390,  ws_currency:'USD', matched_as:'2018 Opus One Napa Valley',     offer:null, created_date:new Date().toISOString() },
      { id:'w3', batch_id:BID, tab:'single', wine_name:'2020 Screaming Eagle Cabernet', vintage:'2020', status:'done', ct_avg_value:3200, ct_auction_avg:3100, ws_avg_price:3500, ws_min_price:2950, ws_currency:'USD', matched_as:'2020 Screaming Eagle Cabernet', offer:null, created_date:new Date().toISOString() },
    ];
    const { page, ctx } = await makePage(browser, BOTH_ENABLED, { extension: true, incognito: true });
    await ctx.route('**/batches?tab=single**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ current: BID, history: [] }) }));
    await ctx.route(`**/${BID}/wines**`, r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(WINES) }));
    await ctx.route('**/wines**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(WINES) }));
    await load(page, '/Lookup');
    await page.waitForTimeout(3000);
    await shot(page, 'lookup-results-table.png');
    await ctx.close(); }

  await browser.close();
  console.log('\n✅ All done!');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
