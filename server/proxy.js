import crypto from 'crypto';
import { chromium } from 'playwright';

const IV_LEN = 12; // GCM recommended IV length

// ── Key material ─────────────────────────────────────────────────────────────

function _masterKeyBuf() {
  return crypto
    .createHash('sha256')
    .update(process.env.CONN_ENC_KEY || 'dev_change_this_to_a_32_byte_key!!')
    .digest(); // 32 bytes
}

// ── Per-user cookie encryption ────────────────────────────────────────────────
// Each user gets a distinct AES-256-GCM key = HMAC-SHA256(CONN_ENC_KEY, userId).
// Rotating CONN_ENC_KEY forces all users to reconnect (all stored cookies break).

export function deriveUserKey(userId) {
  return crypto
    .createHmac('sha256', _masterKeyBuf())
    .update(String(userId))
    .digest(); // 32 bytes
}

export function encryptCookies(userId, cookieArray) {
  const key    = deriveUserKey(userId);
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain  = JSON.stringify(cookieArray);
  let ct       = cipher.update(plain, 'utf8', 'base64');
  ct          += cipher.final('base64');
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct}`;
}

// Decrypts cookies encrypted with encryptCookies().
// Falls back to plain JSON parse for legacy rows stored before encryption was added,
// so existing sessions keep working without a forced re-login.
export function decryptCookies(userId, enc) {
  if (!enc) return [];
  try {
    const parts = String(enc).split(':');
    if (parts.length !== 3) return JSON.parse(enc); // legacy plain JSON
    const key      = deriveUserKey(userId);
    const iv       = Buffer.from(parts[0], 'base64');
    const tag      = Buffer.from(parts[1], 'base64');
    const ct       = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let out  = decipher.update(ct, 'base64', 'utf8');
    out     += decipher.final('utf8');
    return JSON.parse(out);
  } catch {
    return [];
  }
}

// ── Proxy password encryption (uses global key, not per-user) ────────────────

function _encryptProxyPassword(plain) {
  const key    = _masterKeyBuf();
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ct       = cipher.update(String(plain), 'utf8', 'base64');
  ct          += cipher.final('base64');
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct}`;
}

function _decryptProxyPassword(enc) {
  if (!enc) return null;
  try {
    const key      = _masterKeyBuf();
    const parts    = String(enc).split(':');
    if (parts.length !== 3) return enc;
    const iv       = Buffer.from(parts[0], 'base64');
    const tag      = Buffer.from(parts[1], 'base64');
    const ct       = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let out  = decipher.update(ct, 'base64', 'utf8');
    out     += decipher.final('utf8');
    return out;
  } catch {
    return null;
  }
}

// ── Webshare API ──────────────────────────────────────────────────────────────

const WEBSHARE_BASE = 'https://proxy.webshare.io/api/v2';

async function _webshareGet(path) {
  const key = process.env.WEBSHARE_API_KEY;
  if (!key) throw new Error('WEBSHARE_API_KEY is not configured');
  const res = await fetch(`${WEBSHARE_BASE}${path}`, {
    headers: { Authorization: `Token ${key}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Webshare API ${res.status}: ${body}`);
  }
  return res.json();
}

// Sync the Webshare proxy list into the local proxies table.
// Called once on server startup and whenever new proxies are purchased.
// Returns the number of proxies synced.
export async function syncProxies(pool) {
  const data    = await _webshareGet('/proxy/list/?mode=direct&page=1&page_size=100');
  const proxies = data.results || [];
  let synced    = 0;

  for (const p of proxies) {
    await pool.query(
      `INSERT INTO proxies
         (id, proxy_address, http_port, socks5_port, username, password_enc, country_code, city_name, valid, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (id) DO UPDATE SET
         proxy_address = EXCLUDED.proxy_address,
         http_port     = EXCLUDED.http_port,
         socks5_port   = EXCLUDED.socks5_port,
         username      = EXCLUDED.username,
         password_enc  = EXCLUDED.password_enc,
         valid         = EXCLUDED.valid,
         synced_at     = now()`,
      [
        String(p.id),
        p.proxy_address,
        p.port || p.ports?.http || 80,
        p.ports?.socks5 || null,
        p.username,
        _encryptProxyPassword(p.password),
        p.country_code || null,
        p.city_name    || null,
        p.valid !== false,
      ]
    );
    synced++;
  }

  return synced;
}

// Assign a proxy to a user and return its id.
// Rules:
//   - One user always gets the same proxy (idempotent).
//   - A proxy is shared by at most 3 distinct user_ids.
//   - Both CT and WS connections for the same user share one proxy.
export async function assignProxyToUser(pool, userId) {
  // Already assigned — reuse.
  const existing = await pool.query(
    `SELECT proxy_id FROM users_connections WHERE user_id=$1 AND proxy_id IS NOT NULL LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]?.proxy_id) return existing.rows[0].proxy_id;

  // Find the valid proxy with the fewest users that still has room.
  const avail = await pool.query(`
    SELECT   p.id,
             COUNT(DISTINCT uc.user_id) AS user_count
    FROM     proxies p
    LEFT JOIN users_connections uc ON uc.proxy_id = p.id
    WHERE    p.valid = true
    GROUP BY p.id
    HAVING   COUNT(DISTINCT uc.user_id) < 3
    ORDER BY user_count ASC, p.id ASC
    LIMIT    1
  `);

  if (!avail.rows[0]) {
    throw new Error('No proxy capacity available — all proxies are fully assigned (3 users each). Please purchase additional proxies from Webshare.');
  }

  return avail.rows[0].id;
}

// Returns a Playwright-compatible proxy config object for a user, plus metadata
// for logging (proxy_id, country, city). Returns null if no proxy is assigned.
export async function getPlaywrightProxy(pool, userId) {
  if (!userId) return null;

  const r = await pool.query(
    `SELECT p.id, p.proxy_address, p.http_port, p.username, p.password_enc,
            p.country_code, p.city_name
     FROM   proxies p
     JOIN   users_connections uc ON uc.proxy_id = p.id
     WHERE  uc.user_id = $1 AND p.valid = true
     LIMIT  1`,
    [userId]
  );
  if (!r.rows[0]) return null;

  const row      = r.rows[0];
  const password = _decryptProxyPassword(row.password_enc);
  if (!password) return null;

  return {
    // Playwright fields
    server:        `http://${row.proxy_address}:${row.http_port}`,
    username:      row.username,
    password,
    // Logging metadata (not passed to Playwright)
    proxy_id:      row.id,
    proxy_address: row.proxy_address,
    proxy_port:    row.http_port,
    country_code:  row.country_code,
    city_name:     row.city_name,
  };
}

// Audit-log a server-mode outbound request to users_activity.
// Dedicated columns hold: endpoint, http_status, mode, duration_ms.
// activity_details holds the proxy and result metadata that has no dedicated column.
// extras: { proxy_id, proxy_address, proxy_port, country_code, city_name, cookie_count, error }
export async function logProxyRequest(pool, userId, connectionId, endpoint, httpStatus, mode, durationMs = null, extras = {}) {
  try {
    const details = {
      proxy_id:     extras.proxy_id     || null,
      proxy_address:extras.proxy_address|| null,
      proxy_port:   extras.proxy_port   || null,
      country_code: extras.country_code || null,
      city_name:    extras.city_name    || null,
      cookie_count: extras.cookie_count ?? null,
      error:        extras.error        || null,
    };
    await pool.query(
      `INSERT INTO users_activity
         (user_id, connection_id, activity_type, activity_details, endpoint, http_status, mode, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        userId       || null,
        connectionId || null,
        'proxy_request',
        JSON.stringify(details),
        endpoint,
        httpStatus,
        mode || 'server',
        durationMs ?? null,
      ]
    );
  } catch (e) {
    console.warn('[logProxyRequest] Failed to write audit log:', e.message);
  }
}

// Confirm a proxy is actually routing traffic by launching a headless browser,
// navigating to an IP-echo endpoint through the proxy, and comparing the
// returned IP against the expected proxy address.
// Returns { ok: true, ip } on success or { ok: false, error } on failure.
export async function verifyProxyIP(proxyConfig) {
  if (!proxyConfig?.server) return { ok: false, error: 'No proxy config provided' };

  const expectedIP = proxyConfig.proxy_address
    || proxyConfig.server.replace(/^https?:\/\//, '').split(':')[0];

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      proxy: {
        server:   proxyConfig.server,
        username: proxyConfig.username,
        password: proxyConfig.password,
      },
    });
    const context = await browser.newContext();
    const page    = await context.newPage();
    await page.goto('https://api.ipify.org/?format=json', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const body    = await page.evaluate(() => document.body.innerText);
    const { ip }  = JSON.parse(body);
    await browser.close();
    const match   = ip === expectedIP;
    return { ok: match, ip, expected: expectedIP, match };
  } catch (err) {
    try { if (browser) await browser.close(); } catch (e) {}
    return { ok: false, error: String(err), expected: expectedIP };
  }
}
