import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { join as pathJoin, dirname as pathDirname } from 'path';
import { fileURLToPath as pathFileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

dotenv.config();

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

const ALLOWED_ORIGINS = [
  'https://burgundybid.com',
  'https://www.burgundybid.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.EXTRA_CORS_ORIGINS ? process.env.EXTRA_CORS_ORIGINS.split(',') : []),
];

const app = express();

// Trust the first proxy (Cloudflare) so req.ip resolves to the real client IP
// rather than the tunnel's loopback address, and X-Forwarded-For is accepted.
app.set('trust proxy', 1);

// ── CORS must be first so preflight responses and rate-limit 429s include
//    Access-Control-Allow-Origin (middleware fires in registration order).
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, SSE)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Allow any *.vercel.app preview deploys for this project
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return callback(null, true);
    console.error(`CORS: origin ${origin} not allowed`);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
// Explicit OPTIONS pre-flight handler must come before all other middleware so
// preflight requests are answered immediately with CORS headers.
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // disabled — frontend serves its own CSP
  crossOriginEmbedderPolicy: false,
}));

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Global: 200 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use(globalLimiter);

// Auth endpoints: 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
  skipSuccessfulRequests: true, // only count failures against the limit
});

// OCR: 500 requests per 10 minutes per IP (separate from per-user credit limits)
const ocrLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'OCR rate limit exceeded, please slow down.' },
});

// Anti-scraping: 300 data requests per 10 min per authenticated user (admins exempt)
const dataScrapeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.user?.id || 'anon',
  skip: (req) => req.user?.role_type === 'admin',
  validate: { keyGeneratorIpFallback: false },
});


// Optionally parse JWT without hard-requiring it (for optional-auth endpoints)
function parseTokenOptional(req, _res, next) {
  if (!req.user) {
    const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (auth) {
      try { req.user = jwt.verify(auth, JWT_SECRET); } catch (_) {}
    }
  }
  next();
}

// Stripe webhook needs raw body — must come BEFORE bodyParser.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
// Raise limit for /ocr/image which receives base64-encoded images (~10–20 MB)
app.use('/ocr', ocrLimiter, bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;
const rawDbUrl = process.env.DATABASE_URL || '';
if (!rawDbUrl) {
  console.error('[DB] FATAL: DATABASE_URL env var is not set. All database operations will fail.');
}
const connectionString = rawDbUrl.replace(/^postgresql\+psycopg2:\/\//, 'postgres://') || rawDbUrl;
// Log the host (never the password) so deployment logs make it obvious which DB is in use
const dbHost = (() => { try { return new URL(connectionString).host; } catch { return '(unparseable)'; } })();
console.log(`[DB] Using database host: ${dbHost}`);
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

import { ctLogin, wsLogin } from './scrapers.js';
import { syncProxies, assignProxyToUser, getPlaywrightProxy, encryptCookies, logProxyRequest } from './proxy.js';
import { runLookupForBatch } from './lookup.js';
import Queue from 'bull';
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret_replace_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1h';
const REFRESH_TOKEN_EXPIRES_DAYS = 30;

// Generate a secure random refresh token, store its SHA-256 hash in DB
async function createRefreshToken(userId) {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES($1,$2,$3)',
    [userId, hash, expiresAt]
  );
  return raw; // return raw token to client, never store it
}

async function rotateRefreshToken(rawToken) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const r = await pool.query(
    'DELETE FROM refresh_tokens WHERE token_hash=$1 AND expires_at > NOW() RETURNING user_id',
    [hash]
  );
  if (!r.rowCount) return null; // expired or not found
  return r.rows[0].user_id;
}

// ── Activity logging ──────────────────────────────────────────────────────────
// Central helper — never throws; activity logging must never break the main flow.
// activityType values (canonical enum):
//   Auth:           signup, signup_google, login, login_failed, login_google,
//                   login_google_new_user, logout, email_verified,
//                   password_changed, password_reset_requested, password_reset_completed,
//                   profile_updated, account_deleted
//   Support:        support_ticket_created, support_ticket_replied, support_ticket_closed,
//                   support_ticket_deleted, admin_ticket_replied, admin_ticket_status_changed,
//                   admin_suggestion_deleted
//   Suggestions:    suggestion_created, suggestion_deleted
//   Contact:        contact_submitted
//   Lookups:        lookup_created          {batch_id, wine_count, lookup_type}
//                   lookup_limit_exceeded   {batch_id, lookup_type, requested, used, limit, plan}
//                   wine_lookup_run         {batch_id, wine_count, currency, lookup_type, mode:'server'}
//                   lookup_completed        {batch_id, lookup_type, mode, currency, total, completed, ct_errors, ws_errors, with_results}
//                   lookup_error            {batch_id, lookup_type, mode, error}
//                   lookup_wine_error       {lookup_id, batch_id, lookup_type, mode, ct_error, ws_error}
//                   lookup_credits_refunded {batch_id, lookup_type, refunded_count}
//                   ocr_request             {request_id?, cached, status, wines_detected, ocr_pages,
//                                            ocr_doc_size_bytes, parse_input_tokens, parse_output_tokens,
//                                            estimated_cost_usd, stage?, error?}
//   Subscriptions:  subscription_activated, subscription_cancelled, subscription_updated,
//                   subscription_payment_failed
//   Admin:          account_locked, account_unlocked, admin_plan_updated,
//                   admin_credits_awarded
//   Connections:    connection_log, connection_result, connection_error,
//                   connection_removed, connection_removed_on_recreate
async function logActivity(userId, activityType, details = {}, req = null) {
  try {
    const ipAddress = req
      ? (req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null)
      : null;
    const userAgent = req ? (req.headers['user-agent'] || null) : null;
    await pool.query(
      `INSERT INTO users_activity(user_id, activity_type, activity_details, ip_address, user_agent)
       VALUES($1,$2,$3,$4,$5)`,
      [userId || null, activityType, JSON.stringify(details), ipAddress, userAgent]
    );
  } catch (e) {
    // non-fatal — log but never propagate
    console.warn('[logActivity] Failed to write activity:', e.message);
  }
}

// Encryption for storing connection passwords
const ENC_KEY = process.env.CONN_ENC_KEY || 'dev_change_this_to_a_32_byte_key!!'; // passphrase; will be hashed to 32 bytes
const ENC_KEY_BUF = crypto.createHash('sha256').update(String(ENC_KEY)).digest();
const IV_LEN = 12; // 12 bytes for GCM recommended
function encryptText(plain) {
  if (plain === null || plain === undefined) return null;
  try {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY_BUF, iv);
    let ct = cipher.update(String(plain), 'utf8', 'base64');
    ct += cipher.final('base64');
    const tag = cipher.getAuthTag();
    return iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct;
  } catch (e) {
    console.error('encryptText failed', e);
    return null;
  }
}
function decryptText(enc) {
  if (!enc) return null;
  try {
    const parts = String(enc).split(':');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const ct = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY_BUF, iv);
    decipher.setAuthTag(tag);
    let out = decipher.update(ct, 'base64', 'utf8');
    out += decipher.final('utf8');
    return out;
  } catch (e) {
    // decryption failures (wrong key/format) return null
    return null;
  }
}

// In-memory job logs and SSE subscribers (ephemeral; restart clears them)
const jobLogs = new Map(); // connId -> [{ts, msg}]
const sseSubscribers = new Map(); // connId -> Set<res>
// Deduplication guard: prevents two startConnectionJob calls from running the
// same connection concurrently (e.g., rapid double-click or race between the
// PATCH setting run_connect=true and the status guard checking 'connecting').
const _activeConnectionJobs = new Set();

function addLog(connId, msg) {
  const entry = { ts: new Date().toISOString(), msg };
  if (!jobLogs.has(connId)) jobLogs.set(connId, []);
  jobLogs.get(connId).push(entry);
  // trim to last 200 lines
  const arr = jobLogs.get(connId);
  if (arr.length > 200) jobLogs.set(connId, arr.slice(-200));
  // push to SSE subscribers
  const subs = sseSubscribers.get(connId);
  if (subs) {
    for (const res of subs) {
      try {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      } catch (e) {
        // ignore write errors
      }
    }
  }
  // persist to job_logs table if possible (user_id unknown here)
  try {
    pool.query('SELECT user_id FROM users_connections WHERE id=$1', [connId])
      .then(r => {
        const uid = r.rowCount ? r.rows[0].user_id : null;
        return pool.query('INSERT INTO users_activity(user_id,connection_id,activity_type,activity_details) VALUES($1,$2,$3,$4)', [uid, connId, 'connection_log', JSON.stringify({ message: msg })]);
      })
      .catch(() => {});
  } catch (e) {
    // ignore
  }
}

// ── Subscription helpers ──────────────────────────────────────────────────────

// Normalize plan names: keep full suffixed names; map legacy bare 'basic'/'pro' to their monthly variant
function normalizePlan(raw) {
  const s = (raw || 'free').toLowerCase();
  if (s === 'basic') return 'basic_monthly';
  if (s === 'pro')   return 'pro_monthly';
  return s;
}

// Check whether userId has capacity for `batchSize` more lookups this calendar month.
// Returns { allowed, used, limit, remaining, plan, reason? }
async function checkLookupLimit(userId, batchSize = 0) {
  try {
    const uR = await pool.query('SELECT subscription_plan, role_type, bonus_lookup_credits, credits_reset_date, credits_expiry_date FROM users WHERE id=$1', [userId]);
    if (!uR.rowCount) return { allowed: false, reason: 'User not found', used: 0, limit: 0, remaining: 0, plan: 'free' };

    // Admin always gets 99999 lookups, never counted against subscription
    if (uR.rows[0].role_type === 'admin') {
      // Count all non-error records regardless of is_deleted
      const cR = await pool.query(`
        SELECT COUNT(*) FROM wine_lookups
        WHERE user_id=$1
          AND created_date >= date_trunc('month', NOW())
          AND status != 'error'
      `, [userId]);
      const used = parseInt(cR.rows[0].count, 10);
      const limit = 99999;
      return { allowed: true, used, limit, remaining: Math.max(0, limit - used), plan: 'admin' };
    }

    const plan = normalizePlan(uR.rows[0].subscription_plan);
    const creditsExpiryDate = uR.rows[0].credits_expiry_date;

    // Credits expired — 0 remaining regardless of plan
    if (creditsExpiryDate && new Date(creditsExpiryDate) < new Date()) {
      return { allowed: false, reason: 'Your credits have expired. Upgrade to continue using Burgundy Bid.', used: 0, limit: 0, remaining: 0, plan, credits_expired: true, credits_expiry_date: creditsExpiryDate };
    }

    const pR = await pool.query('SELECT monthly_lookup_limit FROM wine_subscriptions WHERE plan_name=$1', [plan]);
    const basePlanLimit = pR.rowCount ? pR.rows[0].monthly_lookup_limit : 20;
    const bonusCredits = parseInt(uR.rows[0].bonus_lookup_credits || 0, 10);
    const limit = basePlanLimit + bonusCredits;
    const isFree = plan === 'free';

    // Free plan: count all-time lookups (credits are lifetime, not monthly).
    // Paid plans: count from the later of start-of-month or last credits reset.
    const creditsResetDate = uR.rows[0].credits_reset_date;
    const cR = isFree
      ? await pool.query(`
          SELECT COUNT(*) FROM wine_lookups
          WHERE user_id=$1 AND status != 'error'
        `, [userId])
      : await pool.query(`
          SELECT COUNT(*) FROM wine_lookups
          WHERE user_id=$1
            AND created_date >= GREATEST(date_trunc('month', NOW()), $2::timestamp)
            AND status != 'error'
        `, [userId, creditsResetDate || new Date(0)]);
    const used = parseInt(cR.rows[0].count, 10);
    const remaining = Math.max(0, limit - used);

    if (used >= limit) {
      const reason = isFree
        ? `Lookup credit limit reached (${limit} total on free plan). Upgrade to continue.`
        : `Monthly lookup limit reached (${limit} on ${plan} plan). Upgrade to continue.`;
      return { allowed: false, reason, used, limit, remaining: 0, plan };
    }
    if (batchSize > 0 && batchSize > remaining) {
      const reason = isFree
        ? `This batch needs ${batchSize} lookups but only ${remaining} remain (${used}/${limit} total used on free plan). Upgrade to continue.`
        : `This batch needs ${batchSize} lookups but only ${remaining} remain this month (${used}/${limit} used on ${plan} plan). Reduce your batch or upgrade.`;
      return { allowed: false, reason, used, limit, remaining, plan };
    }
    return { allowed: true, used, limit, remaining, plan, bonus_lookup_credits: bonusCredits, credits_expiry_date: creditsExpiryDate };
  } catch (e) {
    console.error('checkLookupLimit error', e);
    return { allowed: true, used: 0, limit: 9999, remaining: 9999, plan: 'unknown', bonus_lookup_credits: 0 }; // fail-open on DB errors
  }
}

// Get or lazily create a Stripe Price for the given full plan name (e.g. 'basic_monthly').
// Billing interval is derived from the plan name suffix (_monthly → month, _annually → year).
// Caches the price ID in wine_subscriptions.stripe_price_id so it only creates once.
async function getOrCreateStripePrice(planName) {
  if (!stripe) throw new Error('Stripe not configured');
  const r = await pool.query(
    `SELECT stripe_price_id, monthly_price_cents, annual_price_cents, display_name FROM wine_subscriptions WHERE plan_name=$1`,
    [planName]
  );
  if (!r.rowCount) throw new Error(`Unknown plan: ${planName}`);
  const row = r.rows[0];
  if (row.stripe_price_id) return row.stripe_price_id; // already cached

  const isAnnual = planName.endsWith('_annually');
  const amountCents = isAnnual ? row.annual_price_cents : row.monthly_price_cents;
  const product = await stripe.products.create({
    name: `Burgundy Bid ${row.display_name} Plan`,
    metadata: { plan: planName },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amountCents,
    currency: 'usd',
    recurring: { interval: isAnnual ? 'year' : 'month' },
  });
  await pool.query(`UPDATE wine_subscriptions SET stripe_price_id=$1 WHERE plan_name=$2`, [price.id, planName]);
  return price.id;
}

async function startConnectionJob(connId) {
  // Idempotency guard — skip if another in-process call is already handling
  // this connection (protects against rapid double-submit or queue duplication).
  if (_activeConnectionJobs.has(connId)) {
    addLog(connId, 'Job already in progress — duplicate call skipped');
    return;
  }
  _activeConnectionJobs.add(connId);
  try {
  addLog(connId, 'Job queued');
  try {
    addLog(connId, 'Fetching connection from DB');
    const r = await pool.query('SELECT * FROM users_connections WHERE id=$1', [connId]);
    if (r.rowCount === 0) {
      addLog(connId, 'Connection not found');
      return;
    }
    const conn = r.rows[0];
    // decrypt stored connection password for use by scrapers; abort if decryption fails
    try { conn.password = decryptText(conn.password); } catch (e) { conn.password = null; }
    if (!conn.password) {
      addLog(connId, 'Cannot proceed: stored password could not be decrypted');
      await pool.query(
        `UPDATE users_connections SET status='error', is_error=true, error_message=$1, updated_date=now() WHERE id=$2`,
        ['Stored password could not be decrypted — please reconnect', connId]
      );
      return;
    }
    const site = (conn.site_name || '').toLowerCase();

    // Assign a residential proxy to this user before login so the login request
    // itself also comes from the user's dedicated IP.
    let proxyConfig = null;
    if (conn.user_id) {
      try {
        const proxyId = await assignProxyToUser(pool, conn.user_id);
        await pool.query(
          `UPDATE users_connections
             SET proxy_id=$1, proxy_assigned_at=COALESCE(proxy_assigned_at, now())
           WHERE user_id=$2 AND (proxy_id IS NULL OR proxy_id != $1)`,
          [proxyId, conn.user_id]
        );
        proxyConfig = await getPlaywrightProxy(pool, conn.user_id).catch(() => null);
        if (proxyConfig) addLog(connId, `[proxy] Assigned proxy ${proxyId} for server mode`);
      } catch (e) {
        addLog(connId, `[proxy] Warning: could not assign proxy (${e.message}) — proceeding without`);
      }
    }

    addLog(connId, `Starting login for site: ${conn.site_name}`);
    let result = { success: false, error: 'Unknown site' };
    const _loginStart = Date.now();
    if (site.includes('cellar')) {
      addLog(connId, 'Running Cellar Tracker login...');
      result = await ctLogin(conn.email, conn.password, conn.user_id, proxyConfig);
    } else if (site.includes('wine')) {
      addLog(connId, 'Running Wine Searcher login...');
      // Wipe the persistent browser profile before every (re)connect so that any
      // stale PX fingerprint or previous-user session is fully cleared.
      if (conn.user_id) {
        try {
          const { existsSync, rmSync } = await import('fs');
          const wsProfileDir = pathJoin(pathDirname(pathFileURLToPath(import.meta.url)), '..', '.ws_browser_profiles', String(conn.user_id), 'wine_searcher');
          if (existsSync(wsProfileDir)) {
            rmSync(wsProfileDir, { recursive: true, force: true });
            addLog(connId, '[WS] Cleared persistent browser profile for clean login');
          }
        } catch (e) {
          addLog(connId, `[WS] Profile wipe warning (non-fatal): ${e.message}`);
        }
      }
      result = await wsLogin(conn.email, conn.password, conn.user_id, proxyConfig);
    } else {
      addLog(connId, 'Unsupported site; aborting');
      result = { success: false, error: 'Unsupported site' };
    }
    const _loginDurationMs = Date.now() - _loginStart;

    const accountUsername = result.username || result.displayName || null;
    addLog(connId, `Login finished: success=${Boolean(result.success)} duration=${_loginDurationMs}ms` + (result.error ? ` error=${result.error}` : '') + (accountUsername ? ` account=${accountUsername}` : ''));

    // Save session cookies — always clear old session first, then insert on success.
    // Cookies are encrypted with the user's derived key (never stored in plain text).
    if (conn.user_id) {
      try {
        await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [conn.user_id, conn.site_name]);
        if (result.success && result.cookies && result.cookies.length > 0) {
          await pool.query(
            'INSERT INTO users_sessions(user_id, site, session_cookies, last_used) VALUES($1, $2, $3, now())',
            [conn.user_id, conn.site_name, encryptCookies(conn.user_id, result.cookies)]
          );
          addLog(connId, 'Session cookies encrypted and saved to DB');
        }
      } catch (e) {
        addLog(connId, `Warning: could not update session cookies: ${e}`);
      }
    }

    // Audit: log the server-mode login attempt to users_activity.
    await logProxyRequest(
      pool, conn.user_id, connId, conn.site_name, result.success ? 200 : 401, 'server',
      _loginDurationMs,
      {
        proxy_id:      proxyConfig?.proxy_id      || null,
        proxy_address: proxyConfig?.proxy_address  || null,
        proxy_port:    proxyConfig?.proxy_port     || null,
        country_code:  proxyConfig?.country_code   || null,
        city_name:     proxyConfig?.city_name      || null,
        cookie_count:  result.cookies?.length      ?? null,
        error:         result.success ? null : (result.error || null),
      }
    );

    const now = new Date();
    const updates = [];
    const vals = [];
    if (result.success) {
      updates.push('status = $' + (updates.length + 1)); vals.push('connected');
      updates.push('is_connected = $' + (updates.length + 1)); vals.push(true);
      updates.push('is_error = $' + (updates.length + 1)); vals.push(false);
      updates.push('error_message = $' + (updates.length + 1)); vals.push(null);
      updates.push('last_connected = $' + (updates.length + 1)); vals.push(now);
      if (accountUsername) {
        updates.push('account_username = $' + (updates.length + 1)); vals.push(accountUsername);
      }
      if (result.email) {
        updates.push('email = $' + (updates.length + 1)); vals.push(result.email);
      }
    } else {
      updates.push('status = $' + (updates.length + 1)); vals.push('error');
      updates.push('is_connected = $' + (updates.length + 1)); vals.push(false);
      updates.push('is_error = $' + (updates.length + 1)); vals.push(true);
      updates.push('error_message = $' + (updates.length + 1)); vals.push(result.error || 'Unknown error');
      updates.push('last_connected = $' + (updates.length + 1)); vals.push(now);
    }
    vals.push(connId);
    const sql = `UPDATE users_connections SET ${updates.join(', ')}, updated_date = now() WHERE id = $${vals.length} RETURNING *`;
    const u = await pool.query(sql, vals);
    addLog(connId, 'Database updated with result');
    addLog(connId, `Final connection state: status=${u.rows[0]?.status} proxy_id=${u.rows[0]?.proxy_id}`);
    // Persist sanitised result — never log the encrypted password
    try {
      const { password: _pw, ...safeRow } = u.rows[0] || {};
      await pool.query('INSERT INTO users_activity(user_id,connection_id,activity_type,activity_details) VALUES($1,$2,$3,$4)', [safeRow.user_id, connId, 'connection_result', JSON.stringify(safeRow)]);
    } catch (e) {
      // ignore DB logging errors
    }
  } catch (err) {
    addLog(connId, `Job error: ${String(err)}`);
    try { await pool.query('INSERT INTO users_activity(user_id,connection_id,activity_type,activity_details) VALUES($1,$2,$3,$4)', [null, connId, 'connection_error', JSON.stringify({ error: String(err) })]); } catch (e) {}
  }
  } finally {
    _activeConnectionJobs.delete(connId);
  }
}

// ── Proxy sync ────────────────────────────────────────────────────────────────
// Sync Webshare proxy list into local DB on startup. Non-fatal if Webshare is
// unreachable (server works normally; proxy assignment fails gracefully later).
syncProxies(pool)
  .then(n => console.log(`[proxy] Synced ${n} proxies from Webshare`))
  .catch(e => console.warn('[proxy] Startup sync failed (non-fatal):', e.message));
// Re-sync daily so new purchases appear without a restart.
setInterval(() => {
  syncProxies(pool).catch(e => console.warn('[proxy] Daily sync failed:', e.message));
}, 24 * 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════════════════════════
// ── Crash-safe maintenance scheduler ─────────────────────────────────────────
//
// Design (matches large-company job-runner patterns):
//   • All jobs are registered in the `maintenance_jobs` DB table.
//   • next_run_at persists across server restarts — no job is ever silently lost.
//   • last_status = 'running' + running_since acts as a lightweight advisory lock.
//     A stale lock (running for > 2× the job interval) is automatically broken.
//   • The master loop polls every 5 minutes, so worst-case scheduling lag is 5 min.
//   • Every job fn returns rowCount so the DB record gives operators a quick
//     health snapshot via GET /admin/maintenance without reading log files.
//
// Job registry — maps job_name → async function that returns { rowCount }
// ══════════════════════════════════════════════════════════════════════════════

// ── Individual job functions ──────────────────────────────────────────────────

// Soft-delete wine_lookups older than 6 months for all plans (free, basic, pro).
async function jobSoftDeleteOldLookups() {
  const r = await pool.query(`
    UPDATE wine_lookups wl
    SET is_deleted = true, deleted_date = NOW()
    WHERE wl.is_deleted IS NOT TRUE
      AND wl.created_date < NOW() - INTERVAL '6 months'
  `);
  return { rowCount: r.rowCount };
}

// Hard-delete lookup rows soft-deleted more than 1 month ago.
async function jobHardDeleteOldLookups() {
  const r = await pool.query(`
    DELETE FROM wine_lookups
    WHERE deleted_date IS NOT NULL
      AND deleted_date < NOW() - INTERVAL '1 month'
  `);
  return { rowCount: r.rowCount };
}

// Purge refresh_tokens whose expires_at has passed.
// Prevents unbounded table growth from tokens that were never rotated
// (users who installed the app once and never came back).
async function jobPurgeExpiredRefreshTokens() {
  const r = await pool.query(
    'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
  );
  return { rowCount: r.rowCount };
}

// Two-phase OCR request cleanup:
//   Phase 1 (90 days) — strip the wines_json payload (can be large) so the row
//     stops occupying blob storage, but keep billing metadata (ocr_pages,
//     parse_input_tokens, parse_output_tokens) for cost auditing.
//   Phase 2 (2 years) — hard-delete stripped rows that are now just metadata
//     stubs. 2-year retention satisfies standard financial audit requirements.
async function jobPurgeOldOcrRequests() {
  const strip = await pool.query(`
    UPDATE ocr_requests
    SET wines_json = NULL
    WHERE created_date < NOW() - INTERVAL '90 days'
      AND wines_json IS NOT NULL
  `);
  const del = await pool.query(
    "DELETE FROM ocr_requests WHERE created_date < NOW() - INTERVAL '2 years'"
  );
  return { rowCount: strip.rowCount + del.rowCount };
}

// Reset connections that have been stuck in 'connecting' for more than 10 minutes.
// This catches two failure modes:
//   1. Server crashed or restarted while a job was in flight → record left as 'connecting'.
//   2. Client closed the tab after initiating a connection so the 3-minute client-side
//      timeout handler (Connections.jsx) never fired.
// Interval: every hour (most connections complete within 3 minutes).
async function jobCleanupStaleConnecting() {
  const r = await pool.query(`
    UPDATE users_connections
    SET status       = 'error',
        is_error     = true,
        is_connected = false,
        error_message = 'Connection timed out — please try again',
        updated_date  = NOW()
    WHERE status      = 'connecting'
      AND updated_date < NOW() - INTERVAL '10 minutes'
  `);
  return { rowCount: r.rowCount };
}

// Purge users_sessions whose user account has been deleted.
// Connections are hard-deleted on account deletion but sessions can be orphaned
// by edge cases (direct DB deletes, admin removal).
async function jobPurgeOrphanedSessions() {
  const r = await pool.query(`
    DELETE FROM users_sessions
    WHERE user_id IS NOT NULL
      AND user_id NOT IN (SELECT id FROM users WHERE is_deleted IS NOT TRUE)
  `);
  return { rowCount: r.rowCount };
}

// Hard-delete support tickets soft-deleted more than 90 days ago.
async function jobPurgeOldSupportTickets() {
  const r = await pool.query(`
    DELETE FROM support_tickets
    WHERE is_deleted = true
      AND deleted_date IS NOT NULL
      AND deleted_date < NOW() - INTERVAL '90 days'
  `);
  return { rowCount: r.rowCount };
}

// Hard-delete suggestions soft-deleted more than 90 days ago.
async function jobPurgeOldSuggestions() {
  const r = await pool.query(`
    DELETE FROM suggestions
    WHERE is_deleted = true
      AND deleted_date IS NOT NULL
      AND deleted_date < NOW() - INTERVAL '90 days'
  `);
  return { rowCount: r.rowCount };
}

// Hard-delete contact_submissions soft-deleted more than 90 days ago.
async function jobPurgeOldContactSubmissions() {
  const r = await pool.query(`
    DELETE FROM contact_submissions
    WHERE is_deleted = true
      AND deleted_date IS NOT NULL
      AND deleted_date < NOW() - INTERVAL '90 days'
  `);
  return { rowCount: r.rowCount };
}

// Two-tier activity log retention:
//   Operational events (routine UX actions) → kept 2 years
//   Security events (auth, password, account lifecycle) → kept 3 years
//
// Security events are subject to longer retention in many compliance frameworks
// (SOC 2, GDPR breach evidence, fraud investigations). Three years gives full
// coverage of a typical 2-year limitation period plus a 1-year buffer.
const SECURITY_ACTIVITY_TYPES = [
  'login',
  'login_google',
  'login_failed',
  'signup',
  'signup_google',
  'email_verified',
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  'account_deleted',
];

async function jobPurgeOldActivityLogs() {
  // Phase 1: purge operational events older than 2 years
  const placeholders = SECURITY_ACTIVITY_TYPES.map((_, i) => `$${i + 1}`).join(', ');
  const operational = await pool.query(`
    DELETE FROM users_activity
    WHERE created_date < NOW() - INTERVAL '2 years'
      AND activity_type NOT IN (${placeholders})
  `, SECURITY_ACTIVITY_TYPES);

  // Phase 2: purge security events older than 3 years
  const security = await pool.query(`
    DELETE FROM users_activity
    WHERE created_date < NOW() - INTERVAL '3 years'
      AND activity_type IN (${placeholders})
  `, SECURITY_ACTIVITY_TYPES);

  return { rowCount: operational.rowCount + security.rowCount };
}

// Format a JS Date/timestamp as "25th May 2026".
function formatEmailDate(d) {
  const date = new Date(d);
  const day = date.getUTCDate();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'th'
    : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// Send credit expiry reminder emails at 3 points in the expiry lifecycle:
//   7 days before  → "your credits expire soon"
//   1 day before   → "your credits expire tomorrow"
//   15 days after  → "your connection will be removed in 15 days" (at day 30)
// Deduplication via email_notifications table (unique on user+type+reference_date).
async function jobCreditExpiryReminders() {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://burgundybid.com';
  const upgradeUrl = `${FRONTEND_URL}/Profile?tab=billing`;

  const notifications = [
    {
      type: 'credits_expiry_7d',
      daysOffset: 7,         // credits_expiry_date is this many days in the future
      subject: 'Your Burgundy Bid credits expire in 7 days',
      body: (name, expiryDate) => `
        <p style="margin:0 0 12px;">Hi ${name || 'there'},</p>
        <p style="margin:0 0 20px;color:#555;">Your Burgundy Bid credits will expire in <strong>7 days</strong> (${formatEmailDate(expiryDate)}). Once they expire you won't be able to run new lookups or AI Image Searches.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#ffffff;text-decoration:none;
             font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Upgrade Now</a>
        </div>
        <p style="margin:0;color:#777;font-size:14px;">Upgrading to a Basic or Pro plan gives you a fresh monthly credit allowance and keeps your Wine Searcher and Cellar Tracker connections active.</p>`,
    },
    {
      type: 'credits_expiry_1d',
      daysOffset: 1,
      subject: 'Your Burgundy Bid credits expire tomorrow',
      body: (name, expiryDate) => `
        <p style="margin:0 0 12px;">Hi ${name || 'there'},</p>
        <p style="margin:0 0 20px;color:#555;">This is your final reminder - your Burgundy Bid credits expire <strong>tomorrow, ${formatEmailDate(expiryDate)}</strong>. After that, lookups and AI Image Searches will be blocked until you upgrade.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#ffffff;text-decoration:none;
             font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Upgrade Before It's Too Late</a>
        </div>
        <p style="margin:0;color:#777;font-size:14px;">Your Wine Searcher and Cellar Tracker connections remain active for 30 days after expiry, giving you time to decide.</p>`,
    },
    {
      type: 'credits_expired_15d',
      daysOffset: -15,       // credits_expiry_date was 15 days ago
      subject: 'Your Burgundy Bid connections will be removed in 15 days',
      body: (name, expiryDate) => {
        const removalDate = new Date(new Date(expiryDate).getTime() + 30 * 24 * 60 * 60 * 1000);
        return `
        <p style="margin:0 0 12px;">Hi ${name || 'there'},</p>
        <p style="margin:0 0 20px;color:#555;">Your Burgundy Bid credits expired on ${formatEmailDate(expiryDate)}. If you don't upgrade by <strong>${formatEmailDate(removalDate)}</strong>, your Wine Searcher and Cellar Tracker credentials saved on Burgundy Bid will be automatically removed.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${upgradeUrl}" style="display:inline-block;background:#800020;color:#ffffff;text-decoration:none;
             font-weight:700;font-size:15px;padding:14px 32px;border-radius:6px;">Reactivate My Account</a>
        </div>
        <p style="margin:0;color:#777;font-size:14px;">You can reconnect your accounts at any time after upgrading, but you'll need to re-enter your credentials.</p>`;
      },
    },
  ];

  let totalSent = 0;

  for (const notif of notifications) {
    const isFuture = notif.daysOffset > 0;
    // Match users whose expiry date falls on exactly this calendar day (UTC).
    // Using ::date cast so the window is always midnight-to-midnight regardless of run time.
    const intervalExpr = isFuture
      ? `credits_expiry_date::date = (CURRENT_DATE + INTERVAL '${notif.daysOffset} days')::date`
      : `credits_expiry_date::date = (CURRENT_DATE - INTERVAL '${Math.abs(notif.daysOffset)} days')::date`;

    const rows = await pool.query(`
      SELECT u.id, u.email, u.full_name, u.credits_expiry_date
      FROM users u
      WHERE u.is_deleted = false
        AND u.credits_expiry_date IS NOT NULL
        AND ${intervalExpr}
        AND NOT EXISTS (
          SELECT 1 FROM email_notifications en
          WHERE en.user_id = u.id
            AND en.notification_type = $1
            AND en.reference_date::date = u.credits_expiry_date::date
        )
    `, [notif.type]);

    for (const user of rows.rows) {
      try {
        const name = user.full_name || 'there';
        await sendEmail(user.email, notif.subject, emailTemplate(notif.body(name, user.credits_expiry_date)));
        await pool.query(
          `INSERT INTO email_notifications(user_id, notification_type, reference_date)
           VALUES($1, $2, $3) ON CONFLICT DO NOTHING`,
          [user.id, notif.type, user.credits_expiry_date]
        );
        totalSent++;
      } catch (e) {
        console.warn(`[reminders] Failed to send ${notif.type} to ${user.email}:`, e.message);
      }
    }
  }

  return { rowCount: totalSent };
}

// Remove proxy connections for users whose credits expired more than 30 days ago.
// Deleting from users_connections is the only place proxy_id is stored, so this
// fully frees the proxy slot for reassignment to new users.
async function jobRemoveExpiredConnections() {
  const r = await pool.query(`
    DELETE FROM users_connections uc
    USING users u
    WHERE uc.user_id = u.id
      AND u.credits_expiry_date IS NOT NULL
      AND u.credits_expiry_date < NOW() - INTERVAL '30 days'
      AND u.is_deleted = false
  `);
  if (r.rowCount > 0) {
    console.log(`[maintenance] remove_expired_connections — freed ${r.rowCount} connection(s)`);
  }
  return { rowCount: r.rowCount };
}

// ── Job registry ──────────────────────────────────────────────────────────────
const MAINTENANCE_JOB_REGISTRY = {
  soft_delete_old_lookups:       jobSoftDeleteOldLookups,
  hard_delete_old_lookups:       jobHardDeleteOldLookups,
  purge_expired_refresh_tokens:  jobPurgeExpiredRefreshTokens,
  purge_old_ocr_requests:        jobPurgeOldOcrRequests,
  purge_orphaned_sessions:       jobPurgeOrphanedSessions,
  purge_old_support_tickets:     jobPurgeOldSupportTickets,
  purge_old_suggestions:         jobPurgeOldSuggestions,
  purge_old_contact_submissions: jobPurgeOldContactSubmissions,
  purge_old_activity_logs:       jobPurgeOldActivityLogs,
  cleanup_stale_connecting:      jobCleanupStaleConnecting,
  credit_expiry_reminders:       jobCreditExpiryReminders,
  remove_expired_connections:    jobRemoveExpiredConnections,
};

// ── Core scheduler ────────────────────────────────────────────────────────────

// Runs a single named job immediately and updates its maintenance_jobs record.
// Returns { success, rowCount, error }.
async function runMaintenanceJob(jobName) {
  const fn = MAINTENANCE_JOB_REGISTRY[jobName];
  if (!fn) return { success: false, error: 'Unknown job' };

  // Acquire lock: set status = 'running', record running_since
  await pool.query(`
    UPDATE maintenance_jobs
    SET last_status = 'running', running_since = NOW()
    WHERE job_name = $1
  `, [jobName]);

  try {
    const { rowCount = 0 } = await fn();
    await pool.query(`
      UPDATE maintenance_jobs
      SET last_status   = 'success',
          last_run_at   = NOW(),
          next_run_at   = NOW() + (interval_hours * INTERVAL '1 hour'),
          running_since = NULL,
          last_error    = NULL,
          rows_affected = $1,
          run_count     = run_count + 1
      WHERE job_name = $2
    `, [rowCount, jobName]);
    if (rowCount > 0) {
      console.log(`[maintenance] ${jobName} completed — ${rowCount} row(s) affected`);
    }
    return { success: true, rowCount };
  } catch (e) {
    await pool.query(`
      UPDATE maintenance_jobs
      SET last_status   = 'error',
          last_run_at   = NOW(),
          next_run_at   = NOW() + (interval_hours * INTERVAL '1 hour'),
          running_since = NULL,
          last_error    = $1,
          run_count     = run_count + 1
      WHERE job_name = $2
    `, [e.message, jobName]);
    console.error(`[maintenance] ${jobName} failed:`, e.message);
    // Alert the ops team when a maintenance job fails so it isn't silently missed.
    // Uses the existing sendEmail/Resend infrastructure; ALERT_EMAIL must be set in .env.
    const alertEmail = process.env.ALERT_EMAIL;
    if (alertEmail) {
      try {
        await sendEmail(
          alertEmail,
          `[Burgundy Bid] Maintenance job failed: ${jobName}`,
          `<p>The maintenance job <strong>${jobName}</strong> failed at ${new Date().toISOString()}.</p>
           <p><strong>Error:</strong> ${e.message}</p>
           <p>Check the <code>maintenance_jobs</code> table or visit <code>GET /admin/maintenance</code> for full details.</p>`
        );
      } catch (mailErr) {
        console.warn(`[maintenance] Could not send failure alert email: ${mailErr.message}`);
      }
    }
    return { success: false, error: e.message };
  }
}

// Master scheduler loop — polls every 5 minutes.
// Picks up any job whose next_run_at <= NOW() and whose lock is not held
// (or whose lock is stale: running_since older than 2× the job interval).
async function maintenanceSchedulerTick() {
  try {
    const due = await pool.query(`
      SELECT job_name FROM maintenance_jobs
      WHERE next_run_at <= NOW()
        AND (
          last_status != 'running'
          OR running_since IS NULL
          OR running_since < NOW() - (interval_hours * 2 * INTERVAL '1 hour')
        )
    `);
    for (const { job_name } of due.rows) {
      runMaintenanceJob(job_name); // intentionally not awaited — jobs run concurrently
    }
  } catch (e) {
    console.error('[maintenance] Scheduler tick error:', e.message);
  }
}

// Seed job rows (safe: ON CONFLICT DO NOTHING) then start the master loop.
// Runs 60 seconds after startup so the DB connection pool is fully warm.
setTimeout(async () => {
  try {
    await pool.query(`
      INSERT INTO maintenance_jobs (job_name, interval_hours, next_run_at) VALUES
        ('soft_delete_old_lookups',         24,      NOW()),
        ('hard_delete_old_lookups',         24,      NOW()),
        ('purge_expired_refresh_tokens',    24,      NOW()),
        ('purge_old_ocr_requests',          168,     NOW()),
        ('purge_orphaned_sessions',         24,      NOW()),
        ('purge_old_support_tickets',       168,     NOW()),
        ('purge_old_suggestions',           168,     NOW()),
        ('purge_old_contact_submissions',   168,     NOW()),
        ('purge_old_activity_logs',         168,     NOW()),
        ('cleanup_stale_connecting',        1.0/3.0, NOW()),
        ('credit_expiry_reminders',         24,      NOW()),
        ('remove_expired_connections',      24,      NOW())
      ON CONFLICT (job_name) DO NOTHING
    `);
    // Ensure column can hold fractional hours (idempotent on already-NUMERIC DBs)
    await pool.query(`ALTER TABLE maintenance_jobs ALTER COLUMN interval_hours TYPE NUMERIC USING interval_hours::NUMERIC`);
    // Patch interval on existing DBs where the column was seeded with the old value
    await pool.query(`
      UPDATE maintenance_jobs SET interval_hours = 1.0/3.0
      WHERE job_name = 'cleanup_stale_connecting' AND interval_hours != 1.0/3.0
    `);
  } catch (e) {
    console.warn('[maintenance] Could not seed maintenance_jobs table:', e.message);
  }
  // First tick immediately, then every 5 minutes
  maintenanceSchedulerTick();
  setInterval(maintenanceSchedulerTick, 5 * 60 * 1000);
}, 60 * 1000);

// ── Graceful shutdown — mark in-flight jobs as interrupted ───────────────────
// Without this, a process restart leaves jobs stuck in 'running' state until
// the stale-lock timeout (2× interval_hours) clears them. Marking them
// 'interrupted' on exit lets them re-run immediately on next startup instead
// of waiting for the full stale-lock window.
async function gracefulShutdown(signal) {
  console.log(`[shutdown] Received ${signal} — marking in-flight maintenance jobs as interrupted`);
  try {
    const r = await pool.query(`
      UPDATE maintenance_jobs
      SET last_status   = 'interrupted',
          running_since = NULL,
          next_run_at   = NOW(),
          last_error    = $1
      WHERE last_status = 'running'
    `, [`Process received ${signal}`]);
    if (r.rowCount > 0) {
      console.log(`[shutdown] Marked ${r.rowCount} in-flight job(s) as interrupted`);
    }
  } catch (e) {
    console.warn('[shutdown] Could not update maintenance_jobs on exit:', e.message);
  }
  try { await pool.end(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Email template — responsive, works on mobile + desktop clients ─────────
// color-scheme: light only — prevents Apple Mail / Gmail dark mode from
// re-mapping #800020 and other brand colours to their dark-mode equivalents.
function emailTemplate(bodyHtml, footerNote = '') {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <style>
    :root { color-scheme: light only; }
    body { margin:0; padding:0; background:#f4f4f5; font-family:Arial,Helvetica,sans-serif; color-scheme:light only; }
    @media only screen and (max-width:620px) {
      .wrap  { width:100% !important; }
      .body  { padding:28px 20px !important; }
      .foot  { padding:16px 20px !important; }
      .head  { padding:22px 20px !important; }
    }
  </style>
</head>
<body style="color-scheme:light only;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table class="wrap" width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;
                    overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td class="head" style="background:#800020;padding:26px 40px;" bgcolor="#800020">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;
                         font-family:Georgia,serif;">Burgundy Bid</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td class="body" style="padding:36px 40px;color:#333333;font-size:15px;line-height:1.7;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td class="foot" style="background:#f8f8f9;padding:18px 40px;
                                   border-top:1px solid #eeeeee;">
            <p style="margin:0;color:#999999;font-size:12px;line-height:1.6;">
              ${footerNote || 'You\'re receiving this because you have an account at Burgundy Bid. If you didn\'t expect this email, you can safely ignore it.'}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ── Resend email helper ────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

// Verify Resend API key on startup
resend.emails.send({
  from:    'Burgundy Bid <support@burgundybid.com>',
  to:      ['delivered@resend.dev'],
  subject: 'startup ping',
  html:    '<p>ping</p>',
}).then(({ error }) => {
  if (error) console.error('[email] Resend startup check FAILED:', error.message, JSON.stringify(error));
  else console.log('[email] Resend startup check OK');
});

async function sendEmail(to, subject, htmlBody) {
  const fromName  = process.env.FROM_NAME  || 'Burgundy Bid';
  const fromEmail = process.env.FROM_EMAIL || 'support@burgundybid.com';
  const toArr = Array.isArray(to) ? to : [to];
  const { data, error } = await resend.emails.send({
    from:    `${fromName} <${fromEmail}>`,
    to:      toArr,
    subject,
    html:    htmlBody,
  });
  if (error) {
    console.error(`[email] Resend error sending "${subject}" to ${toArr.join(', ')}:`, error.message, JSON.stringify(error));
    throw new Error(`[email] Resend error: ${error.message}`);
  }
  console.log(`[email] Sent via Resend: "${subject}" → ${toArr.join(', ')} (id: ${data?.id})`);
}


// ── Bot-detection monitor (runs twice a day) ───────────────────────────────
// Checks users_connections.error_message and wine_lookups.ct_error / ws_error
// for keywords that indicate bot-detection (blocked, captcha, bot, PerimeterX).
// Emails the address specified in ALERT_EMAIL if any are found in the last 12 hours.
async function checkBotErrors() {
  console.log('[bot-monitor] Running bot-detection check...');
  try {
    // -- users_connections errors in the last 12 hours --
    const connR = await pool.query(`
      SELECT uc.id, uc.site_name, uc.error_message, uc.updated_date,
             u.email AS user_email
      FROM users_connections uc
      LEFT JOIN users u ON u.id = uc.user_id
      WHERE uc.is_error = true
        AND uc.updated_date > NOW() - INTERVAL '12 hours'
        AND (
          uc.error_message ILIKE '%blocked%'
          OR uc.error_message ILIKE '%captcha%'
          OR uc.error_message ILIKE '%bot%'
          OR uc.error_message ILIKE '%perimeterx%'
        )
      ORDER BY uc.updated_date DESC
      LIMIT 100
    `);

    // -- wine_lookups errors in the last 12 hours --
    const lookupR = await pool.query(`
      SELECT wl.id, wl.wine_name, wl.ct_error, wl.ws_error, wl.created_date,
             u.email AS user_email
      FROM wine_lookups wl
      LEFT JOIN users u ON u.id = wl.user_id
      WHERE wl.is_deleted IS NOT TRUE
        AND wl.created_date > NOW() - INTERVAL '12 hours'
        AND (
          wl.ct_error ILIKE '%blocked%' OR wl.ct_error ILIKE '%captcha%'
          OR wl.ct_error ILIKE '%bot%'  OR wl.ct_error ILIKE '%perimeterx%'
          OR wl.ws_error ILIKE '%blocked%' OR wl.ws_error ILIKE '%captcha%'
          OR wl.ws_error ILIKE '%bot%'     OR wl.ws_error ILIKE '%perimeterx%'
        )
      ORDER BY wl.created_date DESC
      LIMIT 100
    `);

    const connErrors   = connR.rows;
    const lookupErrors = lookupR.rows;

    if (connErrors.length === 0 && lookupErrors.length === 0) {
      console.log('[bot-monitor] No bot-detection errors found.');
      return;
    }

    console.log(`[bot-monitor] Found ${connErrors.length} connection error(s) and ${lookupErrors.length} lookup error(s) — sending alert email.`);

    // Collect the matched keywords across all errors
    const BOT_KEYWORDS = ['blocked', 'captcha', 'bot', 'perimeterx'];
    const foundKeywords = new Set();
    for (const r of connErrors) {
      const msg = (r.error_message || '').toLowerCase();
      BOT_KEYWORDS.forEach(kw => { if (msg.includes(kw)) foundKeywords.add(kw); });
    }
    for (const r of lookupErrors) {
      const combined = ((r.ct_error || '') + ' ' + (r.ws_error || '')).toLowerCase();
      BOT_KEYWORDS.forEach(kw => { if (combined.includes(kw)) foundKeywords.add(kw); });
    }
    const keywordsStr = [...foundKeywords].join(', ');
    const sourceStr   = connErrors.length > 0 && lookupErrors.length > 0
      ? 'connection and lookup'
      : connErrors.length > 0 ? 'connection' : 'lookup';

    const now = new Date().toUTCString();
    let html = `
      <h2 style="color:#800020;font-family:sans-serif;">⚠️ Bot-Detection Alert — Burgundy Bid</h2>
      <p style="font-family:sans-serif;color:#555;">Detected at: <strong>${now}</strong></p>
      <p style="font-family:sans-serif;color:#555;">Keywords found: <strong>${keywordsStr}</strong></p>
    `;

    if (connErrors.length > 0) {
      html += `<h3 style="font-family:sans-serif;">Connection Errors (${connErrors.length})</h3>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px;width:100%">
          <tr style="background:#800020;color:white"><th>Site</th><th>User</th><th>Error</th><th>Time</th></tr>`;
      for (const r of connErrors) {
        html += `<tr>
          <td>${r.site_name || ''}</td>
          <td>${r.user_email || r.id}</td>
          <td>${r.error_message || ''}</td>
          <td>${new Date(r.updated_date).toUTCString()}</td>
        </tr>`;
      }
      html += `</table><br/>`;
    }

    if (lookupErrors.length > 0) {
      html += `<h3 style="font-family:sans-serif;">Lookup Errors (${lookupErrors.length})</h3>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px;width:100%">
          <tr style="background:#800020;color:white"><th>Wine</th><th>User</th><th>CT Error</th><th>WS Error</th><th>Time</th></tr>`;
      for (const r of lookupErrors) {
        html += `<tr>
          <td>${r.wine_name || ''}</td>
          <td>${r.user_email || r.id}</td>
          <td>${r.ct_error || ''}</td>
          <td>${r.ws_error || ''}</td>
          <td>${new Date(r.created_date).toUTCString()}</td>
        </tr>`;
      }
      html += `</table><br/>`;
    }

    html += `<p style="font-family:sans-serif;color:#999;font-size:12px;">This alert is sent automatically by Burgundy Bid when bot-detection errors are detected.</p>`;

    const subject = `Found ${keywordsStr} in the burgundy bid ${sourceStr}, Action Needed Now`;
    await sendEmail(process.env.ALERT_EMAIL_TWO, subject, html);
  } catch (e) {
    console.error('[bot-monitor] Error during check:', e);
  }
}

// Run twice a day: immediately at startup + every 12 hours
setTimeout(() => {
  checkBotErrors();
  setInterval(checkBotErrors, 12 * 60 * 60 * 1000);
}, 5 * 60 * 1000); // staggered 5 min after startup

// ── System alerts helper ───────────────────────────────────────────────────
// Write a system alert to system_alerts and email ALERT_EMAIL_TWO.
async function raiseSystemAlert({ alertType, severity = 'warning', title, message, details = null }) {
  try {
    await pool.query(
      `INSERT INTO system_alerts(alert_type, severity, title, message, details)
       VALUES($1,$2,$3,$4,$5)`,
      [alertType, severity, title, message, details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('[system_alert] DB insert failed:', e.message);
  }
  try {
    const html = `
      <h2 style="font-family:sans-serif;color:#800020;">${title}</h2>
      <p style="font-family:sans-serif;">${message}</p>
      ${details ? `<pre style="background:#f5f5f5;padding:12px;font-size:12px;">${JSON.stringify(details, null, 2)}</pre>` : ''}
      <p style="font-family:sans-serif;color:#999;font-size:12px;">Raised at ${new Date().toISOString()} — check Admin Workspace → Alerts tab.</p>
    `;
    await sendEmail(process.env.ALERT_EMAIL_TWO, `[Burgundy Bid Alert] ${title}`, html);
  } catch (e) {
    console.warn('[system_alert] Email failed:', e.message);
  }
}

// ── Selector health-check job ──────────────────────────────────────────────
// Detects broken CT/WS login form selectors by looking at real user error data
// rather than making outbound HTTP requests from the server IP (which WS would
// always PX-block, producing false alarms, and which could damage our IP's reputation).
//
// Strategy: connectCT() and connectWS() in background.js emit very specific
// "form not found" error messages when a CSS selector lookup fails in the user's
// real browser.  If ≥2 distinct users hit those errors in the past 48 hours it
// almost certainly means a CT/WS page structure change — not a per-user issue.
//
// Selector-failure error fingerprints (must match background.js exactly):
//   CT: 'Login form not found'       (connectCT step 3)
//   WS: 'Sign-in form not found'     (connectWS step 6)
//
// These strings are NOT present in PX errors so there are no false positives.

async function checkLoginSelectors() {
  console.log('[selector-health] Checking for CT/WS form-not-found errors in recent connection attempts...');

  try {
    const window48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const r = await pool.query(`
      SELECT
        site_name,
        COUNT(DISTINCT user_id) AS affected_users,
        array_agg(DISTINCT error_message ORDER BY error_message) AS messages
      FROM users_connections
      WHERE is_error = true
        AND updated_date > $1
        AND (
          error_message ILIKE '%Login form not found%'
          OR error_message ILIKE '%Sign-in form not found%'
          OR error_message ILIKE '%form not found%'
        )
        -- Exclude PX errors — those are caught by the PX systemic monitor
        AND error_message NOT ILIKE '%perimeterx%'
        AND error_message NOT ILIKE '%bot-detection%'
        AND error_message NOT ILIKE '%press & hold%'
      GROUP BY site_name
      HAVING COUNT(DISTINCT user_id) >= 2
    `, [window48h]);

    if (r.rowCount === 0) {
      console.log('[selector-health] No form-not-found errors across multiple users — selectors appear OK.');
      return;
    }

    // ≥2 distinct users on the same site hit a "form not found" error → likely a
    // page structure change.  Only alert if no recent unresolved alert of this type.
    const existing = await pool.query(
      `SELECT id FROM system_alerts WHERE alert_type='selector_failure' AND resolved=false AND created_date > now() - interval '24 hours' LIMIT 1`
    );
    if (existing.rowCount > 0) {
      console.log('[selector-health] Unresolved selector_failure alert already exists — skipping duplicate.');
      return;
    }

    const affectedSites = r.rows.map(row => {
      const label = row.site_name === 'cellar_tracker' ? 'Cellar Tracker'
                  : row.site_name === 'wine_searcher'  ? 'Wine-Searcher'
                  : row.site_name;
      return { site: label, affectedUsers: parseInt(row.affected_users, 10), messages: row.messages };
    });
    const siteNames = affectedSites.map(s => s.site).join(', ');

    console.warn('[selector-health] Form-not-found errors detected:', affectedSites);
    await raiseSystemAlert({
      alertType: 'selector_failure',
      severity:  'critical',
      title:     `Login selector failure on ${siteNames}`,
      message:   `${affectedSites.map(s => `${s.site}: ${s.affectedUsers} user(s) hit "form not found" in the last 48 hours`).join('; ')}. The login page structure may have changed. Review connectCT/connectWS selectors in background.js and update if needed.`,
      details:   { affectedSites, window: '48h' },
    });

  } catch (e) {
    console.error('[selector-health] Error:', e.message);
  }
}

// Run every 6 hours — relies on DB data, not outbound HTTP, so frequent polling
// is safe and catches selector breakage within a few hours of users reporting it.
setTimeout(() => {
  checkLoginSelectors();
  setInterval(checkLoginSelectors, 6 * 60 * 60 * 1000);
}, 12 * 60 * 1000); // 12 min after startup (after PX monitor's 7 min)

// ── PX systemic failure detector ───────────────────────────────────────────
// Checks the last 30 minutes for PX-related lookup/connection failures across
// multiple users.  If ≥3 distinct users are seeing PX blocks, it is likely
// that PerimeterX has updated its challenge and the extension bypass needs
// updating — this is NOT a per-user issue.
async function checkPxSystemicFailures() {
  try {
    const windowAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // Connection failures
    const connR = await pool.query(`
      SELECT COUNT(DISTINCT user_id) AS affected_users, array_agg(DISTINCT error_message) AS messages
      FROM users_connections
      WHERE is_error = true
        AND updated_date > $1
        AND (
          error_message ILIKE '%perimeterx%'
          OR error_message ILIKE '%bot-detection%'
          OR error_message ILIKE '%press & hold%'
          OR error_message ILIKE '%access to this page has been denied%'
          OR error_message ILIKE '%px-captcha%'
        )
    `, [windowAgo]);

    // Lookup failures
    const lookupR = await pool.query(`
      SELECT COUNT(DISTINCT user_id) AS affected_users
      FROM wine_lookups
      WHERE created_date > $1
        AND (
          ws_error ILIKE '%perimeterx%' OR ws_error ILIKE '%bot%' OR ws_error ILIKE '%captcha%'
          OR ct_error ILIKE '%perimeterx%' OR ct_error ILIKE '%bot%' OR ct_error ILIKE '%captcha%'
        )
        AND is_deleted = false
    `, [windowAgo]);

    const connAffected   = parseInt(connR.rows[0]?.affected_users   || 0, 10);
    const lookupAffected = parseInt(lookupR.rows[0]?.affected_users || 0, 10);
    const totalAffected  = Math.max(connAffected, lookupAffected);

    if (totalAffected >= 3) {
      console.warn(`[px-monitor] Systemic PX failure: ${totalAffected} distinct users affected in last 30 min`);
      // Only raise if there isn't already an unresolved alert of this type from the last hour
      const existing = await pool.query(
        `SELECT id FROM system_alerts WHERE alert_type='px_systemic' AND resolved=false AND created_date > now() - interval '1 hour' LIMIT 1`
      );
      if (existing.rowCount === 0) {
        await raiseSystemAlert({
          alertType: 'px_systemic',
          severity:  'critical',
          title:     `Systemic PerimeterX block — ${totalAffected} users affected`,
          message:   `In the last 30 minutes, ${totalAffected} distinct users have hit PerimeterX blocks. This likely indicates a PX challenge update. Review background.js solvePxInTab() and wsGoogleRecovery() and update selectors if needed.`,
          details:   { connAffected, lookupAffected, windowAgo },
        });
      }
    } else {
      console.log(`[px-monitor] No systemic PX failures (${totalAffected} users affected — threshold is 3).`);
    }
  } catch (e) {
    console.error('[px-monitor] Error:', e.message);
  }
}

// Run every 30 minutes
setTimeout(() => {
  checkPxSystemicFailures();
  setInterval(checkPxSystemicFailures, 30 * 60 * 1000);
}, 7 * 60 * 1000); // staggered 7 min after startup

// If REDIS_URL is provided, create a Redis-backed queue and worker
let connectsQueue = null;
if (process.env.REDIS_URL) {
  try {
    connectsQueue = new Queue('connects', process.env.REDIS_URL);
    // Process jobs in this same process for now
    connectsQueue.process(async (job) => {
      const { connectionId } = job.data;
      await startConnectionJob(connectionId);
    });
    console.log('Connects queue started (Redis)');
  } catch (e) {
    console.error('Failed to initialize Redis queue', e);
    connectsQueue = null;
  }
}

// ── Lookup concurrency limiter ────────────────────────────────────────────────
// Prevents more than LOOKUP_MAX_CONCURRENT Chrome instances running simultaneously.
// With 500+ users, each lookup spawns 1-2 browser processes. Without a limit this
// would exhaust server RAM. Jobs queue up and users see their position in the SSE log.
const LOOKUP_MAX_CONCURRENT = parseInt(process.env.LOOKUP_CONCURRENCY || '20', 10);
let _lookupActiveCount = 0;
const _lookupWaitQueue = []; // [{ resolve, batchId, userId }]
const _lookupRunning = new Set(); // batchIds currently executing

function _lookupEnqueue(batchId, userId) {
  // If this exact batch is already running, skip
  if (_lookupRunning.has(batchId)) return Promise.resolve('already_running');
  return new Promise(resolve => {
    _lookupWaitQueue.push({ resolve, batchId, userId });
    _lookupFlush();
  });
}

function _lookupRelease(batchId) {
  _lookupRunning.delete(batchId);
  _lookupActiveCount--;
  _lookupFlush();
}

function _lookupFlush() {
  while (_lookupActiveCount < LOOKUP_MAX_CONCURRENT && _lookupWaitQueue.length > 0) {
    const job = _lookupWaitQueue.shift();
    _lookupActiveCount++;
    _lookupRunning.add(job.batchId);
    job.resolve('go');
  }
}

// auth middleware
async function authMiddleware(req, res, next) {
  let auth = req.headers.authorization || '';
  // allow token in query param for SSE EventSource clients (access_token)
  if (!auth && req.query && (req.query.access_token || req.query.token)) {
    const t = req.query.access_token || req.query.token;
    auth = `Bearer ${t}`;
  }
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' });
  const token = auth.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // ensure account still exists and is active
    try {
      const r = await pool.query('SELECT is_deleted FROM users WHERE email=$1', [payload.email]);
      if (r.rowCount === 0) return res.status(401).json({ error: 'Invalid token user' });
      if (r.rows[0].is_deleted) return res.status(401).json({ error: 'Account deleted' });
    } catch (dbErr) {
      console.error('authMiddleware DB check failed', dbErr);
      return res.status(500).json({ error: 'Internal error' });
    }
    req.user = payload; // { id, email, role_type }
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// admin middleware — must come after authMiddleware in the chain
async function adminMiddleware(req, res, next) {
  try {
    const r = await pool.query('SELECT role_type FROM users WHERE id=$1', [req.user.id]);
    if (r.rowCount === 0 || r.rows[0].role_type !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

// ── Admin Workspace endpoints ────────────────────────────────────────────────
// All require auth + admin

// List all support tickets (all users, including deleted) with submitter info
app.get('/admin/tickets', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT t.*, u.email as user_email, u.full_name as user_name
               FROM support_tickets t
               LEFT JOIN users u ON u.id = t.user_id`;
    const params = [];
    if (status) { sql += ` WHERE t.status = $1`; params.push(status); }
    sql += ` ORDER BY t.created_date DESC LIMIT 500`;
    const r = await pool.query(sql, params);
    const tickets = r.rows;
    if (tickets.length === 0) return res.json([]);
    // Attach replies for each ticket
    const ids = tickets.map(t => t.id);
    const repliesR = await pool.query(
      `SELECT * FROM ticket_replies WHERE ticket_id = ANY($1) ORDER BY created_date ASC`,
      [ids]
    );
    const repliesByTicket = {};
    for (const reply of repliesR.rows) {
      if (!repliesByTicket[reply.ticket_id]) repliesByTicket[reply.ticket_id] = [];
      repliesByTicket[reply.ticket_id].push(reply);
    }
    return res.json(tickets.map(t => ({ ...t, replies: repliesByTicket[t.id] || [] })));
  } catch (err) {
    console.error('[admin/tickets]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: soft-delete a ticket
app.delete('/admin/tickets/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE support_tickets SET is_deleted=true, deleted_date=now(), closed_at=now(), updated_date=now() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Update a ticket status / add admin reply
app.patch('/admin/tickets/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { status, admin_reply, priority } = req.body || {};
  try {
    // Block adding a reply to a closed ticket (status changes are still allowed)
    if (admin_reply && admin_reply.trim()) {
      const check = await pool.query(`SELECT status FROM support_tickets WHERE id=$1`, [req.params.id]);
      if (check.rows[0]?.status === 'closed') {
        return res.status(403).json({ error: 'Cannot reply to a closed ticket' });
      }
    }
    const updates = ['updated_date=now()'];
    const vals = [];
    if (status) { vals.push(status); updates.push(`status=$${vals.length}`); }
    if (admin_reply !== undefined) { vals.push(admin_reply); updates.push(`admin_reply=$${vals.length}`, `admin_replied_at=now()`); }
    if (priority) { vals.push(priority); updates.push(`priority=$${vals.length}`); }
    if (status === 'closed') updates.push('closed_at=now()');
    else if (status && status !== 'closed') updates.push('closed_at=NULL');
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE support_tickets SET ${updates.join(',')} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    // Log admin reply as a new reply entry
    if (admin_reply && admin_reply.trim()) {
      const adminR = await pool.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.id]);
      const adminInfo = adminR.rows[0] || {};
      await pool.query(
        `INSERT INTO ticket_replies(ticket_id, author_type, author_name, author_email, body)
         VALUES($1,'admin',$2,$3,$4)`,
        [req.params.id, adminInfo.full_name || 'Admin', adminInfo.email || '', admin_reply.trim()]
      ).catch(() => {});
      logActivity(req.user.id, 'admin_ticket_replied', { ticket_id: req.params.id, admin_id: req.user.id }, req);
    }
    if (status) {
      logActivity(r.rows[0].user_id, 'admin_ticket_status_changed', { ticket_id: req.params.id, new_status: status, changed_by: req.user.id }, req);
    }
    const repliesR = await pool.query(
      `SELECT * FROM ticket_replies WHERE ticket_id=$1 ORDER BY created_date ASC`,
      [req.params.id]
    );
    return res.json({ ...r.rows[0], replies: repliesR.rows });
  } catch (err) {
    console.error('[admin/tickets PATCH]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: soft-delete a suggestion
app.delete('/admin/suggestions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE suggestions SET is_deleted=true, deleted_date=now(), updated_date=now() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'admin_suggestion_deleted', { suggestion_id: req.params.id, owner_user_id: r.rows[0].user_id }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Admin: soft-delete a contact submission
app.delete('/admin/contact-submissions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE contact_submissions SET is_deleted=true, deleted_date=now() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List all suggestions (all users)
app.get('/admin/suggestions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT s.*, u.email as user_email, u.full_name as user_name
               FROM suggestions s
               LEFT JOIN users u ON u.id = s.user_id`;
    const params = [];
    if (status) { sql += ` WHERE s.status = $1`; params.push(status); }
    sql += ` ORDER BY s.created_date DESC LIMIT 500`;
    const r = await pool.query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    console.error('[admin/suggestions]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Update suggestion status
app.patch('/admin/suggestions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  try {
    const r = await pool.query(
      `UPDATE suggestions SET status=$1, updated_date=now() WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// List all contact form submissions (unauthenticated landing page messages)
app.get('/admin/contact-submissions', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT * FROM contact_submissions`;
    const params = [];
    if (status) { sql += ` WHERE status = $1`; params.push(status); }
    sql += ` ORDER BY created_date DESC LIMIT 500`;
    const r = await pool.query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    console.error('[admin/contact-submissions]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Update contact submission status
app.patch('/admin/contact-submissions/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'status required' });
  try {
    const r = await pool.query(
      `UPDATE contact_submissions SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Admin: check if current user is admin
app.get('/admin/me', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ is_admin: true, id: req.user.id, email: req.user.email });
});

// Admin: test email delivery
app.post('/admin/test-email', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { to } = req.body || {};
    const recipient = to || req.user.email;
    await sendEmail(recipient, 'Burgundy Bid — Email Test', emailTemplate(`
      <p>This is a test email from your Burgundy Bid server.</p>
      <p style="color:#555;font-size:13px;">If you received this, email delivery is working correctly.</p>
    `));
    res.json({ success: true, sent_to: recipient });
  } catch (err) {
    console.error('[admin/test-email]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── User settings (calc columns, etc.) ──────────────────────────────────────

app.get('/user/settings', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT calc_columns FROM user_column_settings WHERE user_id=$1',
      [req.user.id]
    );
    res.json({ calc_columns: r.rowCount > 0 ? r.rows[0].calc_columns : [] });
  } catch (err) {
    console.error('[user/settings GET]', err);
    res.status(500).json({ error: String(err) });
  }
});

app.put('/user/settings', authMiddleware, async (req, res) => {
  try {
    const { calc_columns } = req.body || {};
    if (!Array.isArray(calc_columns)) return res.status(400).json({ error: 'calc_columns must be an array' });
    await pool.query(
      `INSERT INTO user_column_settings(user_id, calc_columns, updated_date)
       VALUES($1, $2, now())
       ON CONFLICT(user_id) DO UPDATE SET calc_columns=$2, updated_date=now()`,
      [req.user.id, JSON.stringify(calc_columns)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[user/settings PUT]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: list all users with lock status
app.get('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role_type, u.subscription_plan, u.is_deleted,
              u.failed_login_attempts, u.locked_until, u.created_date, u.last_login,
              u.bonus_lookup_credits, u.bonus_ocr_credits,
              COALESCE(lu.used_lookups, 0) AS used_lookups,
              COALESCE(ou.used_ocr, 0) AS used_ocr,
              COALESCE((
                SELECT ws.monthly_lookup_limit FROM wine_subscriptions ws
                WHERE ws.plan_name = CASE
                  WHEN LOWER(COALESCE(u.subscription_plan, 'free')) = 'basic' THEN 'basic_monthly'
                  WHEN LOWER(COALESCE(u.subscription_plan, 'free')) = 'pro'   THEN 'pro_monthly'
                  ELSE LOWER(COALESCE(u.subscription_plan, 'free'))
                END
                LIMIT 1
              ), 20) AS monthly_lookup_limit,
              COALESCE((
                SELECT ws.monthly_ocr_limit FROM wine_subscriptions ws
                WHERE ws.plan_name = CASE
                  WHEN LOWER(COALESCE(u.subscription_plan, 'free')) = 'basic' THEN 'basic_monthly'
                  WHEN LOWER(COALESCE(u.subscription_plan, 'free')) = 'pro'   THEN 'pro_monthly'
                  ELSE LOWER(COALESCE(u.subscription_plan, 'free'))
                END
                LIMIT 1
              ), 2) AS monthly_ocr_limit
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS used_lookups
         FROM wine_lookups
         WHERE created_date >= date_trunc('month', NOW()) AND status != 'error'
         GROUP BY user_id
       ) lu ON lu.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS used_ocr
         FROM ocr_requests
         WHERE created_date >= date_trunc('month', NOW()) AND status = 'success'
         GROUP BY user_id
       ) ou ON ou.user_id = u.id
       ORDER BY u.created_date DESC`
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[admin/users]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Admin: lock a user account manually
app.post('/admin/users/:id/lock', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { reason, duration_hours = 24 } = req.body || {};
  try {
    const lockedUntil = new Date(Date.now() + Number(duration_hours) * 60 * 60 * 1000);
    const r = await pool.query(
      'UPDATE users SET locked_until=$1 WHERE id=$2 RETURNING id, email, full_name, locked_until',
      [lockedUntil, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
    // Log activity
    await pool.query(
      'INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1,$2,$3)',
      [id, 'account_locked', JSON.stringify({ locked_by: req.user.id, reason: reason || 'Admin action', locked_until: lockedUntil })]
    ).catch(() => {});
    // Notify user by email (non-blocking)
    const u = r.rows[0];
    sendEmail(u.email, 'Your Burgundy Bid account has been temporarily locked', emailTemplate(`
      <p>Hi ${u.full_name || 'there'},</p>
      <p>Your account has been temporarily locked by our team${reason ? ` for the following reason: <strong>${reason}</strong>` : ''}.</p>
      <p>Your account will be automatically unlocked at <strong>${lockedUntil.toUTCString()}</strong>.</p>
      <p>If you believe this is an error, please contact us at <a href="mailto:support@burgundybid.com">support@burgundybid.com</a>.</p>
    `)).catch(() => {});
    return res.json({ success: true, user: r.rows[0] });
  } catch (e) {
    console.error('[admin/users/lock]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Admin: unlock a user account
app.post('/admin/users/:id/unlock', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query(
      'UPDATE users SET locked_until=NULL, failed_login_attempts=0 WHERE id=$1 RETURNING id, email, full_name',
      [id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
    await pool.query(
      'INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1,$2,$3)',
      [id, 'account_unlocked', JSON.stringify({ unlocked_by: req.user.id })]
    ).catch(() => {});
    const u = r.rows[0];
    sendEmail(u.email, 'Your Burgundy Bid account has been unlocked', emailTemplate(`
      <p>Hi ${u.full_name || 'there'},</p>
      <p>Your account has been unlocked and you can now sign in again.</p>
      <p>If you have questions, contact us at <a href="mailto:support@burgundybid.com">support@burgundybid.com</a>.</p>
    `)).catch(() => {});
    return res.json({ success: true, user: r.rows[0] });
  } catch (e) {
    console.error('[admin/users/unlock]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Admin: get all plan configurations
app.get('/admin/plans', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT plan_name, display_name, monthly_lookup_limit, monthly_ocr_limit,
              monthly_price_cents, annual_price_cents, features, stripe_price_id
       FROM wine_subscriptions
       ORDER BY COALESCE(NULLIF(monthly_price_cents, 0), annual_price_cents) ASC NULLS FIRST`
    );
    return res.json(r.rows);
  } catch (e) {
    console.error('[admin/plans GET]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Admin: update plan limits (lookup limit, OCR limit, prices)
app.patch('/admin/plans/:planName', authMiddleware, adminMiddleware, async (req, res) => {
  const { planName } = req.params;
  const { monthly_lookup_limit, monthly_ocr_limit, monthly_price_cents, annual_price_cents } = req.body || {};

  const ALLOWED_PLANS = ['free', 'basic_monthly', 'basic_annually', 'pro_monthly', 'pro_annually', 'admin'];
  if (!ALLOWED_PLANS.includes(planName)) {
    return res.status(400).json({ error: 'Invalid plan name' });
  }

  const updates = [];
  const vals = [];

  if (monthly_lookup_limit !== undefined) {
    const v = parseInt(monthly_lookup_limit, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'monthly_lookup_limit must be a non-negative integer' });
    updates.push(`monthly_lookup_limit = $${vals.length + 1}`); vals.push(v);
  }
  if (monthly_ocr_limit !== undefined) {
    const v = parseInt(monthly_ocr_limit, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'monthly_ocr_limit must be a non-negative integer' });
    updates.push(`monthly_ocr_limit = $${vals.length + 1}`); vals.push(v);
  }
  if (monthly_price_cents !== undefined) {
    const v = parseInt(monthly_price_cents, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'monthly_price_cents must be a non-negative integer' });
    updates.push(`monthly_price_cents = $${vals.length + 1}`); vals.push(v);
  }
  if (annual_price_cents !== undefined) {
    const v = parseInt(annual_price_cents, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'annual_price_cents must be a non-negative integer' });
    updates.push(`annual_price_cents = $${vals.length + 1}`); vals.push(v);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  vals.push(planName);
  try {
    const r = await pool.query(
      `UPDATE wine_subscriptions SET ${updates.join(', ')} WHERE plan_name = $${vals.length} RETURNING *`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Plan not found' });
    await pool.query(
      'INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1,$2,$3)',
      [req.user.id, 'admin_plan_updated', JSON.stringify({ plan: planName, changes: req.body })]
    ).catch(() => {});
    return res.json({ success: true, plan: r.rows[0] });
  } catch (e) {
    console.error('[admin/plans PATCH]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Admin: award (or set) bonus lookup/OCR credits for a user
app.post('/admin/users/:id/credits', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { bonus_lookup_credits, bonus_ocr_credits, note, replace } = req.body || {};

  if (bonus_lookup_credits === undefined && bonus_ocr_credits === undefined) {
    return res.status(400).json({ error: 'At least one of bonus_lookup_credits or bonus_ocr_credits is required' });
  }

  const updates = [];
  const vals = [];
  const changes = {};

  if (bonus_lookup_credits !== undefined) {
    const v = parseInt(bonus_lookup_credits, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'bonus_lookup_credits must be a non-negative integer' });
    if (replace) {
      updates.push(`bonus_lookup_credits = $${vals.length + 1}`); vals.push(v);
    } else {
      updates.push(`bonus_lookup_credits = GREATEST(0, bonus_lookup_credits + $${vals.length + 1})`); vals.push(v);
    }
    changes.bonus_lookup_credits = v;
  }

  if (bonus_ocr_credits !== undefined) {
    const v = parseInt(bonus_ocr_credits, 10);
    if (isNaN(v) || v < 0) return res.status(400).json({ error: 'bonus_ocr_credits must be a non-negative integer' });
    if (replace) {
      updates.push(`bonus_ocr_credits = $${vals.length + 1}`); vals.push(v);
    } else {
      updates.push(`bonus_ocr_credits = GREATEST(0, bonus_ocr_credits + $${vals.length + 1})`); vals.push(v);
    }
    changes.bonus_ocr_credits = v;
  }

  vals.push(id);
  try {
    const r = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${vals.length}
       RETURNING id, email, full_name, bonus_lookup_credits, bonus_ocr_credits`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });
    await pool.query(
      'INSERT INTO users_activity(user_id, activity_type, activity_details) VALUES($1,$2,$3)',
      [id, 'admin_credits_awarded', JSON.stringify({ awarded_by: req.user.id, changes, note: note || null, replace: !!replace })]
    ).catch(() => {});
    return res.json({ success: true, user: r.rows[0] });
  } catch (e) {
    console.error('[admin/credits]', e);
    res.status(500).json({ error: String(e) });
  }
});

// ── System alerts admin endpoints ──────────────────────────────────────────
app.get('/admin/system-alerts', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const showResolved = req.query.resolved === 'true';
    const r = await pool.query(
      `SELECT * FROM system_alerts
       WHERE ($1 OR resolved = false)
       ORDER BY created_date DESC LIMIT 200`,
      [showResolved]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/system-alerts/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE system_alerts SET resolved=true, resolved_at=now(), resolved_by=$1 WHERE id=$2 RETURNING *`,
      [req.user.email, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Alert not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: connection errors — with optional ?range=7|30|90|365|all
app.get('/admin/errors/connections', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rangeMap = { '7': 7, '30': 30, '90': 90, '365': 365, all: null };
    const days = Object.prototype.hasOwnProperty.call(rangeMap, req.query.range) ? rangeMap[req.query.range] : null;
    let startDate = null;
    if (days !== null) { const d = new Date(); d.setDate(d.getDate() - days); startDate = d.toISOString(); }
    const params = startDate ? [startDate] : [];
    const r = await pool.query(`
      SELECT uc.id, uc.site_name, uc.status, uc.error_message, uc.updated_date,
             uc.is_error, uc.last_connected, uc.created_date,
             u.id AS user_id, u.full_name, u.email
      FROM users_connections uc
      JOIN users u ON u.id = uc.user_id
      WHERE (uc.is_error = true OR (uc.error_message IS NOT NULL AND uc.error_message != ''))
      ${startDate ? 'AND uc.updated_date >= $1' : ''}
      ORDER BY uc.updated_date DESC
      LIMIT 500
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: security errors — credential/session mismatch events
app.get('/admin/errors/security', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ua.id, ua.created_date, ua.activity_details, ua.user_id,
             u.email, u.full_name
      FROM   users_activity ua
      JOIN   users u ON u.id = ua.user_id
      WHERE  ua.activity_type = 'security_error'
      ORDER  BY ua.created_date DESC
      LIMIT  200
    `);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: analytics summary — aggregate counts across all users
app.get('/admin/analytics/summary', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [accounts, lookups, connErr, payments, plans, billing, cancelled] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE is_deleted IS NOT TRUE) AS active_accounts,
          COUNT(*) FILTER (WHERE is_deleted = true)     AS deleted_accounts
        FROM users
      `),
      pool.query(`
        SELECT
          COUNT(*)                                                                                  AS total_lookups,
          COUNT(*) FILTER (WHERE ct_error IS NOT NULL AND ct_error NOT IN ('not enabled','no connection')) AS ct_errors,
          COUNT(*) FILTER (WHERE ws_error IS NOT NULL AND ws_error NOT IN ('not enabled','no connection')) AS ws_errors,
          COUNT(*) FILTER (WHERE (ct_error IS NOT NULL AND ct_error NOT IN ('not enabled','no connection'))
                              OR (ws_error IS NOT NULL AND ws_error NOT IN ('not enabled','no connection'))) AS total_lookup_errors
        FROM wine_lookups WHERE is_deleted = false
      `),
      pool.query(`
        SELECT COUNT(*) AS connection_errors
        FROM users_connections
        WHERE is_error = true OR (error_message IS NOT NULL AND error_message != '')
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(amount), 0) AS total_payments,
          COALESCE(SUM(amount) FILTER (WHERE billing_interval = 'monthly'), 0) AS monthly_revenue,
          COALESCE(SUM(amount) FILTER (WHERE billing_interval = 'annual'), 0)  AS annual_revenue,
          COUNT(*) FILTER (WHERE billing_interval = 'monthly') AS monthly_transactions,
          COUNT(*) FILTER (WHERE billing_interval = 'annual')  AS annual_transactions
        FROM users_payments WHERE payment_status IN ('succeeded','completed')
      `),
      pool.query(`
        SELECT subscription_plan, COUNT(*) AS count
        FROM users WHERE is_deleted IS NOT TRUE
        GROUP BY subscription_plan
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE subscription_plan LIKE '%_monthly'  AND subscription_plan NOT IN ('free','admin')) AS monthly_subs,
          COUNT(*) FILTER (WHERE subscription_plan LIKE '%_annually' AND subscription_plan NOT IN ('free','admin')) AS annual_subs
        FROM users WHERE is_deleted IS NOT TRUE
      `),
      pool.query(`
        SELECT COUNT(*) AS cancelled_count
        FROM users WHERE subscription_ended IS NOT NULL AND is_deleted IS NOT TRUE
      `),
    ]);
    const planMap = {};
    plans.rows.forEach(r => { planMap[r.subscription_plan] = parseInt(r.count); });
    res.json({
      active_accounts:       parseInt(accounts.rows[0].active_accounts),
      deleted_accounts:      parseInt(accounts.rows[0].deleted_accounts),
      total_lookups:         parseInt(lookups.rows[0].total_lookups),
      ct_errors:             parseInt(lookups.rows[0].ct_errors),
      ws_errors:             parseInt(lookups.rows[0].ws_errors),
      total_lookup_errors:   parseInt(lookups.rows[0].total_lookup_errors),
      connection_errors:     parseInt(connErr.rows[0].connection_errors),
      total_payments:        parseFloat(payments.rows[0].total_payments),
      monthly_revenue:       parseFloat(payments.rows[0].monthly_revenue),
      annual_revenue:        parseFloat(payments.rows[0].annual_revenue),
      monthly_transactions:  parseInt(payments.rows[0].monthly_transactions),
      annual_transactions:   parseInt(payments.rows[0].annual_transactions),
      plan_free:             planMap['free']  || 0,
      plan_basic:            (planMap['basic_monthly'] || 0) + (planMap['basic_annually'] || 0),
      plan_pro:              (planMap['pro_monthly']   || 0) + (planMap['pro_annually']   || 0),
      monthly_subs:          parseInt(billing.rows[0].monthly_subs),
      annual_subs:           parseInt(billing.rows[0].annual_subs),
      cancelled_subscriptions: parseInt(cancelled.rows[0].cancelled_count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: analytics time-series — group by day/week/month/year with optional range filter
app.get('/admin/analytics/timeseries', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const VALID_TRUNC = { day: 'day', week: 'week', month: 'month', year: 'year' };
    const rangeMap = { '7': 7, '30': 30, '90': 90, '365': 365, all: null };
    // Whitelist-validate trunc — inject directly (safe) since we validate against VALID_TRUNC
    const trunc = VALID_TRUNC[req.query.group_by] || 'day';
    const days  = Object.prototype.hasOwnProperty.call(rangeMap, req.query.range)
      ? rangeMap[req.query.range] : 30;

    let startDate = null;
    if (days !== null) {
      const d = new Date();
      d.setDate(d.getDate() - days);
      startDate = d.toISOString();
    }

    // date_trunc identifier cannot be parameterised in CockroachDB — inject whitelisted value directly
    const [signups, lookups, payments, connErrors] = await Promise.all([
      pool.query(
        `SELECT date_trunc('${trunc}', created_date) AS period, COUNT(*) AS signups
         FROM users ${startDate ? 'WHERE created_date >= $1' : ''}
         GROUP BY period ORDER BY period`,
        startDate ? [startDate] : []
      ),
      pool.query(
        `SELECT date_trunc('${trunc}', created_date) AS period,
                COUNT(*) AS total_lookups,
                COUNT(*) FILTER (WHERE ct_error IS NOT NULL AND ct_error NOT IN ('not enabled','no connection')) AS ct_errors,
                COUNT(*) FILTER (WHERE ws_error IS NOT NULL AND ws_error NOT IN ('not enabled','no connection')) AS ws_errors
         FROM wine_lookups
         WHERE is_deleted = false ${startDate ? 'AND created_date >= $1' : ''}
         GROUP BY period ORDER BY period`,
        startDate ? [startDate] : []
      ),
      pool.query(
        `SELECT date_trunc('${trunc}', created_date) AS period,
                COUNT(*) AS transactions,
                COALESCE(SUM(amount), 0) AS revenue
         FROM users_payments
         WHERE payment_status IN ('succeeded','completed') ${startDate ? 'AND created_date >= $1' : ''}
         GROUP BY period ORDER BY period`,
        startDate ? [startDate] : []
      ),
      pool.query(
        `SELECT date_trunc('${trunc}', updated_date) AS period, COUNT(*) AS conn_errors
         FROM users_connections
         WHERE (is_error = true OR (error_message IS NOT NULL AND error_message != ''))
         ${startDate ? 'AND updated_date >= $1' : ''}
         GROUP BY period ORDER BY period`,
        startDate ? [startDate] : []
      ),
    ]);

    // Merge all series into a single array keyed by period
    const periodMap = {};
    const ensure = (p) => {
      const k = new Date(p).toISOString();
      if (!periodMap[k]) periodMap[k] = { period: p, signups: 0, total_lookups: 0, ct_errors: 0, ws_errors: 0, transactions: 0, revenue: 0, conn_errors: 0 };
      return periodMap[k];
    };
    signups.rows.forEach(r   => { const e = ensure(r.period); e.signups       = parseInt(r.signups); });
    lookups.rows.forEach(r   => { const e = ensure(r.period); e.total_lookups = parseInt(r.total_lookups); e.ct_errors = parseInt(r.ct_errors); e.ws_errors = parseInt(r.ws_errors); });
    payments.rows.forEach(r  => { const e = ensure(r.period); e.transactions  = parseInt(r.transactions); e.revenue   = parseFloat(r.revenue); });
    connErrors.rows.forEach(r => { const e = ensure(r.period); e.conn_errors  = parseInt(r.conn_errors); });

    const rows = Object.values(periodMap).sort((a, b) => new Date(a.period) - new Date(b.period));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: per-user analytics — tenure, payment counts, plan
app.get('/admin/analytics/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.subscription_plan,
        u.is_deleted,
        u.created_date,
        u.last_login,
        u.subscription_started,
        u.subscription_ended,
        EXTRACT(DAY FROM now() - u.created_date)::int AS days_on_app,
        COALESCE(p.payment_count, 0)       AS payment_count,
        COALESCE(p.total_spent, 0)         AS total_spent,
        COALESCE(l.lookup_count, 0)        AS lookup_count
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS payment_count, SUM(amount) AS total_spent
        FROM users_payments WHERE payment_status IN ('succeeded','completed')
        GROUP BY user_id
      ) p ON p.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS lookup_count
        FROM wine_lookups WHERE is_deleted = false
        GROUP BY user_id
      ) l ON l.user_id = u.id
      ORDER BY u.created_date DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: per-user usage analytics — OCR, proxy sessions, lookups, forgot-password events
app.get('/admin/analytics/user-usage', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.subscription_plan,
        -- OCR all time
        COALESCE(ocr_all.total_requests, 0)       AS ocr_total,
        COALESCE(ocr_all.total_pages, 0)          AS ocr_pages_total,
        -- OCR this month
        COALESCE(ocr_mo.monthly_requests, 0)      AS ocr_monthly,
        COALESCE(ocr_mo.monthly_pages, 0)         AS ocr_pages_monthly,
        -- Lookups / credits all time
        COALESCE(lu_all.lookup_total, 0)          AS lookup_total,
        -- Lookups / credits this month
        COALESCE(lu_mo.lookup_monthly, 0)         AS lookup_monthly,
        -- Proxy sessions all time
        COALESCE(px_all.proxy_total, 0)           AS proxy_total,
        -- Proxy sessions this month
        COALESCE(px_mo.proxy_monthly, 0)          AS proxy_monthly,
        -- Forgot password all time
        COALESCE(fp_all.fp_total, 0)              AS forgot_password_total,
        -- Forgot password this month
        COALESCE(fp_mo.fp_monthly, 0)             AS forgot_password_monthly,
        -- DB row footprint estimate
        COALESCE(lu_all.lookup_total, 0) + COALESCE(ocr_all.total_requests, 0) AS db_rows_total
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS total_requests, COALESCE(SUM(ocr_pages), 0) AS total_pages
        FROM ocr_requests WHERE status = 'success'
        GROUP BY user_id
      ) ocr_all ON ocr_all.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS monthly_requests, COALESCE(SUM(ocr_pages), 0) AS monthly_pages
        FROM ocr_requests
        WHERE status = 'success' AND created_date >= date_trunc('month', NOW())
        GROUP BY user_id
      ) ocr_mo ON ocr_mo.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS lookup_total
        FROM wine_lookups WHERE is_deleted = false
        GROUP BY user_id
      ) lu_all ON lu_all.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS lookup_monthly
        FROM wine_lookups
        WHERE is_deleted = false AND created_date >= date_trunc('month', NOW())
        GROUP BY user_id
      ) lu_mo ON lu_mo.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS proxy_total
        FROM users_activity WHERE activity_type = 'proxy_request'
        GROUP BY user_id
      ) px_all ON px_all.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS proxy_monthly
        FROM users_activity
        WHERE activity_type = 'proxy_request' AND created_date >= date_trunc('month', NOW())
        GROUP BY user_id
      ) px_mo ON px_mo.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS fp_total
        FROM users_activity WHERE activity_type = 'password_reset_requested'
        GROUP BY user_id
      ) fp_all ON fp_all.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS fp_monthly
        FROM users_activity
        WHERE activity_type = 'password_reset_requested' AND created_date >= date_trunc('month', NOW())
        GROUP BY user_id
      ) fp_mo ON fp_mo.user_id = u.id
      WHERE u.is_deleted IS NOT TRUE
      ORDER BY u.created_date DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Admin: lookup errors — with optional ?range=7|30|90|365|all, excludes non-error skip messages
app.get('/admin/errors/lookups', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rangeMap = { '7': 7, '30': 30, '90': 90, '365': 365, all: null };
    const days = Object.prototype.hasOwnProperty.call(rangeMap, req.query.range) ? rangeMap[req.query.range] : null;
    let startDate = null;
    if (days !== null) { const d = new Date(); d.setDate(d.getDate() - days); startDate = d.toISOString(); }
    const params = startDate ? [startDate] : [];
    const r = await pool.query(`
      SELECT wl.id, wl.wine_name, wl.vintage, wl.size, wl.status,
             wl.ct_error, wl.ws_error, wl.updated_date, wl.created_date,
             wl.batch_id, wl.ct_url, wl.ws_url,
             u.id AS user_id, u.full_name, u.email
      FROM wine_lookups wl
      JOIN users u ON u.id = wl.user_id
      WHERE (
        (wl.ct_error IS NOT NULL AND wl.ct_error NOT IN ('not enabled','no connection'))
        OR (wl.ws_error IS NOT NULL AND wl.ws_error NOT IN ('not enabled','no connection'))
      )
      AND wl.is_deleted = false
      ${startDate ? 'AND wl.updated_date >= $1' : ''}
      ORDER BY wl.updated_date DESC
      LIMIT 500
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// protect entity routes + apply per-user scrape limiter
app.use('/entities', authMiddleware, dataScrapeLimit);
// apply scrape limiter to batch history endpoints (optional auth, so parse token first)
app.use('/batches', parseTokenOptional, dataScrapeLimit);

// ── Health check ──────────────────────────────────────────────────────────────
// Returns DB reachability + maintenance job health so load balancers and uptime
// monitors can detect both "server crashed" and "jobs silently failing" states.
app.get('/_health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    let jobHealth = null;
    try {
      const jobsR = await pool.query(`
        SELECT job_name, last_status, last_run_at, next_run_at, last_error
        FROM maintenance_jobs
        ORDER BY job_name
      `);
      const failedJobs = jobsR.rows.filter(j => j.last_status === 'error');
      jobHealth = { total: jobsR.rowCount, failed: failedJobs.length, jobs: jobsR.rows };
    } catch (_) {
      jobHealth = { error: 'maintenance_jobs table not yet created' };
    }
    return res.json({ ok: true, db: 'connected', maintenance: jobHealth });
  } catch (e) {
    return res.status(503).json({ ok: false, db: 'error', error: e.message });
  }
});

// Generic entity endpoints for WineLookup and SiteCredential
app.get('/entities/:entity', async (req, res) => {
  const { entity } = req.params;
  const q = req.query;
  const user = req.user; // set by authMiddleware
    try {
      if (entity === 'WineLookup') {
      const { batch_id, limit = 200 } = q;
      const clauses = [];
      // Exclude deleted lookups by default unless caller requests inclusion
      const includeDeleted = q.include_deleted === 'true' || q.include_deleted === '1';
      if (!includeDeleted) clauses.push(`is_deleted = false`);
      const params = [];
      if (batch_id) {
        clauses.push(`batch_id = $${params.length + 1}`);
        params.push(batch_id);
      }
      // enforce ownership unless admin
      if (user.role_type !== 'admin') {
        clauses.push(`user_id = $${params.length + 1}`);
        params.push(user.id);
      } else if (q.user_id) {
        // admin may filter by user_id
        clauses.push(`user_id = $${params.length + 1}`);
        params.push(q.user_id);
      }
      let sql = 'SELECT * FROM wine_lookups';
      if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
      sql += ' ORDER BY created_date DESC LIMIT $' + (params.length + 1);
      params.push(Number(limit));
      const r = await pool.query(sql, params);
      // strip passwords — never expose to client
      r.rows.forEach(row => { row.password = null; });
      return res.json(r.rows);
    } else if (entity === 'SiteCredential') {
      // Return credentials for the logged-in user from users_connections
      const params = [];
      let sql = 'SELECT * FROM users_connections';
      if (user.role_type !== 'admin') {
        sql += ' WHERE user_id = $1';
        params.push(user.id);
      } else if (q.user_id) {
        sql += ' WHERE user_id = $1';
        params.push(q.user_id);
      }
      const r = await pool.query(sql, params);
      // strip passwords — never expose to client
      r.rows.forEach(row => { row.password = null; });
      return res.json(r.rows); 
    }
    res.status(404).json({ error: 'Unknown entity' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});
app.post('/entities/:entity', async (req, res) => {
  const { entity } = req.params;
  const data = req.body || {};
  const user = req.user;
  try {
    if (entity === 'WineLookup') {
      // set user_id to authenticated user unless admin provided one
      if (!data.user_id || user.role_type !== 'admin') data.user_id = user.id;
      if (data.ws_currency) data.ws_currency = data.ws_currency.replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
      if (data.ct_currency) data.ct_currency = data.ct_currency.replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
      else if (!data.ct_currency) data.ct_currency = inferCurrencyFromPrice(data.ct_avg || data.ct_auction);
      const lookupType = batchIdToLookupType(data.batch_id);
      const cols = ['user_id','wine_name','vintage','size','ct_avg','ct_auction','ws_avg','ws_min','ct_url','ws_url','offer_price','matched_as','batch_id','status','ws_currency','ct_currency','lookup_type'];
      const vals = cols.map(c => c === 'lookup_type' ? lookupType : c === 'status' ? (data[c] ?? 'pending') : (data[c] ?? null));
      const placeholders = vals.map((_, i) => `$${i+1}`).join(',');
      const sql = `INSERT INTO wine_lookups(${cols.join(',')}) VALUES(${placeholders}) RETURNING *`;
      const r = await pool.query(sql, vals);
      logActivity(user.id, 'lookup_created', { batch_id: data.batch_id, wine_count: 1, lookup_type: lookupType }, req);
      return res.json(r.rows[0]);
    } else if (entity === 'SiteCredential') {
      // Map SiteCredential entity to users_connections table and use user_id
      // Canonicalize site_name to prevent duplicate per-site records (one per user per site)
      const rawSite = (data.site_name || data.site || '').toString();
      const normalizeSite = (s) => {
        const v = (s || '').toLowerCase();
        if (v.includes('cellar')) return 'cellar_tracker';
        if (v.includes('wine')) return 'wine_searcher';
        return v.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      };
      const siteName = normalizeSite(rawSite);

      // If an existing connection for this user+site exists, remove it and record in users_activity.
      // Also purge any stored session cookies so the new connection always starts clean.
      try {
        const existing = await pool.query('SELECT * FROM users_connections WHERE user_id=$1 AND site_name=$2', [user.id, siteName]);
        if (existing.rowCount > 0) {
          for (const row of existing.rows) {
            try {
              await pool.query('INSERT INTO users_activity(user_id,connection_id,activity_type,activity_details) VALUES($1,$2,$3,$4)', [user.id, row.id, 'connection_removed', JSON.stringify(row)]);
            } catch (e) { /* ignore logging errors */ }
            await pool.query('DELETE FROM users_connections WHERE id=$1', [row.id]);
          }
        }
        await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [user.id, siteName]);
      } catch (e) {
        console.error('failed to cleanup existing connections', e);
      }

      const cols = ['user_id','site_name','email','password','is_connected','is_enabled','last_connected'];
      const vals = [user.id, siteName || null, data.username || data.email || null, data.password || null, data.is_connected ?? false, data.is_enabled ?? true, data.last_connected || null];
      // encrypt the password before storing
      try { vals[3] = encryptText(vals[3]); } catch (e) { /* ignore */ }
      const placeholders = vals.map((_, i) => `$${i+1}`).join(',');
      const sql = `INSERT INTO users_connections(${cols.join(',')}) VALUES(${placeholders}) RETURNING *`;
      const r = await pool.query(sql, vals);
      const created = r.rows[0];
      created.password = null; // never return password to client
      // If caller requested immediate connect (e.g., Save & Connect), start background job
      if (data.run_connect) {
        try {
          // mark this connection as connecting before starting the job
          try {
            await pool.query('UPDATE users_connections SET status=$1, is_connected=$2, is_error=$3, error_message=$4, updated_date=now() WHERE id=$5', ['connecting', false, false, null, created.id]);
          } catch (e) {}
          if (connectsQueue) {
            // enqueue to Redis-backed queue so workers/processes can pick it up
            await connectsQueue.add({ connectionId: created.id });
            addLog(created.id, 'Enqueued job to Redis queue (on create)');
          } else {
            // spawn but don't await when running in-process
            startConnectionJob(created.id);
          }
        } catch (e) {
          console.error('failed to start connection job', e);
        }
      }
      return res.json(created);
    }
    res.status(404).json({ error: 'Unknown entity' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/entities/:entity/bulk', async (req, res) => {
  const { entity } = req.params;
  const records = req.body || [];
  try {
    if (entity === 'WineLookup') {
      const user = req.user;
      // Enforce monthly lookup limit (admin bypasses)
      if (user.role_type !== 'admin') {
        const limitCheck = await checkLookupLimit(user.id, records.length);
        if (!limitCheck.allowed) {
          logActivity(user.id, 'lookup_limit_exceeded', {
            batch_id: records[0]?.batch_id || null,
            lookup_type: batchIdToLookupType(records[0]?.batch_id),
            requested: records.length,
            used: limitCheck.used,
            limit: limitCheck.limit,
            plan: limitCheck.plan,
          }, req);
          return res.status(402).json({
            error: limitCheck.reason,
            upgrade_required: true,
            used: limitCheck.used,
            limit: limitCheck.limit,
            remaining: limitCheck.remaining,
            plan: limitCheck.plan,
          });
        }
      }
      const results = [];
      const batchLookupType = batchIdToLookupType(records[0]?.batch_id);
      for (const rec of records) {
        const data = { ...rec };
        if (!data.user_id || user.role_type !== 'admin') data.user_id = user.id;
        // Sanitize ws_currency and ct_currency if provided
        if (data.ws_currency) data.ws_currency = data.ws_currency.replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
        if (data.ct_currency) data.ct_currency = data.ct_currency.replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';
        else if (!data.ct_currency) data.ct_currency = inferCurrencyFromPrice(data.ct_avg || data.ct_auction);
        const cols = ['user_id','wine_name','vintage','size','ct_avg','ct_auction','ws_avg','ws_min','ct_url','ws_url','offer_price','matched_as','batch_id','status','ws_currency','ct_currency','lookup_type'];
        const vals = cols.map(c => c === 'lookup_type' ? batchLookupType : c === 'status' ? (data[c] ?? 'pending') : (data[c] ?? null));
        const placeholders = vals.map((_, i) => `$${i+1}`).join(',');
        const sql = `INSERT INTO wine_lookups(${cols.join(',')}) VALUES(${placeholders}) RETURNING *`;
        const r = await pool.query(sql, vals);
        results.push(r.rows[0]);
      }
      logActivity(user.id, 'lookup_created', { batch_id: records[0]?.batch_id || null, wine_count: results.length, lookup_type: batchLookupType }, req);
      return res.json(results);
    }
    res.status(404).json({ error: 'Unknown entity or bulk not supported' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.put('/entities/:entity/:id', async (req, res) => {
  const { entity, id } = req.params;
  const data = req.body || {};
  try {
    const user = req.user;
    if (entity === 'WineLookup') {
      // ensure ownership or admin
      const check = await pool.query('SELECT user_id FROM wine_lookups WHERE id=$1', [id]);
      if (check.rowCount === 0) return res.status(404).json({ error: 'Not found' });
      const owner = check.rows[0].user_id;
      if (user.role_type !== 'admin' && String(owner) !== String(user.id)) return res.status(403).json({ error: 'Forbidden' });
      // Auto-stamp deleted_date when soft-deleting
      if (data.is_deleted === true && data.deleted_date === undefined) {
        data.deleted_date = new Date().toISOString();
      }
      const WINE_LOOKUP_MUTABLE = new Set([
        'wine_name','vintage','size','offer_price','status','ct_avg','ct_auction',
        'ws_avg','ws_min','ct_url','ws_url','ws_currency','ct_currency','matched_as',
        'is_deleted','deleted_date','batch_id',
      ]);
      const fields = Object.keys(data).filter(f => WINE_LOOKUP_MUTABLE.has(f));
      if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(',');
      const vals = fields.map(f => data[f]);
      vals.push(id);
      const sql = `UPDATE wine_lookups SET ${sets}, updated_date = now() WHERE id=$${vals.length} RETURNING *`;
      const r = await pool.query(sql, vals);
      return res.json(r.rows[0]);
    } else if (entity === 'SiteCredential') {
      // operate on users_connections
      const check = await pool.query('SELECT user_id, site_name FROM users_connections WHERE id=$1', [id]);
      if (check.rowCount === 0) return res.status(404).json({ error: 'Not found' });
      const owner    = check.rows[0].user_id;
      const siteName = check.rows[0].site_name;
      if (user.role_type !== 'admin' && String(owner) !== String(user.id)) return res.status(403).json({ error: 'Forbidden' });

      // If caller requests a reconnect for a previously errored record, update in-place
      // rather than delete+recreate — this preserves the connection ID and full audit trail.
      try {
        const existingFull = await pool.query('SELECT * FROM users_connections WHERE id=$1', [id]);
        const existingRow = existingFull.rowCount ? existingFull.rows[0] : null;
        if (existingRow && data.run_connect && existingRow.status === 'error') {
          // Log the reconnect attempt so the history of prior failures is preserved.
          try {
            await pool.query(
              'INSERT INTO users_activity(user_id,connection_id,activity_type,activity_details) VALUES($1,$2,$3,$4)',
              [user.id, existingRow.id, 'connection_reconnect_attempt',
               JSON.stringify({ previous_error: existingRow.error_message, previous_status: existingRow.status })]
            );
          } catch (e) {}

          // Determine password: use new plaintext if provided, else keep encrypted value.
          let encPwd = existingRow.password;
          if (data.password) {
            try { encPwd = encryptText(data.password); } catch (e) {}
          }

          // Clear any stored session so the reconnect always starts fresh.
          try { await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [owner, siteName]); } catch (e) {}

          // Reset the record in-place — same ID, no data loss.
          const resetR = await pool.query(
            `UPDATE users_connections
               SET status='connecting', is_connected=false, is_error=false,
                   error_message=NULL, email=COALESCE($1, email), password=$2,
                   updated_date=now()
             WHERE id=$3 RETURNING *`,
            [data.email || data.username || null, encPwd, existingRow.id]
          );
          const updated = resetR.rows[0];
          updated.password = null; // never return password to client

          // Enqueue job using the same (preserved) record ID.
          try {
            if (connectsQueue) {
              await connectsQueue.add({ connectionId: updated.id });
              addLog(updated.id, 'Enqueued job to Redis queue (reconnect on error)');
            } else {
              startConnectionJob(updated.id);
            }
          } catch (e) { console.error('failed to start connection job on reconnect', e); }
          return res.json(updated);
        }
      } catch (e) {
        // ignore and fall back to normal update behavior below
      }

      const SITE_CRED_MUTABLE = new Set([
        'email','username','password','status','is_connected','is_enabled','is_error',
        'error_message','last_connected',
      ]);
      const fields = Object.keys(data).filter(f => SITE_CRED_MUTABLE.has(f));
      if (fields.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
      const sets = fields.map((f, i) => `${f}=$${i+1}`).join(',');
      const vals = fields.map(f => {
        if (f === 'password') return encryptText(data[f]);
        return data[f];
      });
      vals.push(id);
      const sql = `UPDATE users_connections SET ${sets}, updated_date = now() WHERE id=$${vals.length} RETURNING *`;
      const r = await pool.query(sql, vals);
      const updated = r.rows[0];
      updated.password = null; // never return password to client
      // if requested, enqueue connection attempt
      if (data.run_connect) {
        try {
          // Clear any stored session before starting a new connection attempt.
          try { await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [owner, siteName]); } catch (e) {}
          // mark as connecting before enqueueing
          try {
            await pool.query('UPDATE users_connections SET status=$1, is_connected=$2, is_error=$3, error_message=$4, updated_date=now() WHERE id=$5', ['connecting', false, false, null, updated.id]);
          } catch (e) {}
          if (connectsQueue) {
            await connectsQueue.add({ connectionId: updated.id });
            addLog(updated.id, 'Enqueued job to Redis queue (on update)');
          } else {
            startConnectionJob(updated.id);
          }
        } catch (e) {
          console.error('failed to start connection job on update', e);
        }
      }
      return res.json(r.rows[0]);
    }
    res.status(404).json({ error: 'Unknown entity' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Trigger a connection attempt for a saved user_connection
app.post('/connect/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query('SELECT * FROM users_connections WHERE id=$1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const conn = r.rows[0];
    // ensure ownership
    if (req.user.role_type !== 'admin' && String(conn.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });

    const site = (conn.site_name || '').toLowerCase();
    // decrypt password for use by scrapers; abort if decryption fails
    try { conn.password = decryptText(conn.password); } catch (e) { conn.password = null; }
    if (!conn.password) return res.status(422).json({ error: 'Stored password could not be decrypted — please reconnect' });

    // Assign a proxy before login so the request comes from the user's dedicated IP.
    let proxyConfig = null;
    if (conn.user_id) {
      try {
        const proxyId = await assignProxyToUser(pool, conn.user_id);
        await pool.query(
          `UPDATE users_connections
             SET proxy_id=$1, proxy_assigned_at=COALESCE(proxy_assigned_at, now())
           WHERE user_id=$2 AND (proxy_id IS NULL OR proxy_id != $1)`,
          [proxyId, conn.user_id]
        );
        proxyConfig = await getPlaywrightProxy(pool, conn.user_id).catch(() => null);
      } catch (e) {
        console.warn('[proxy] /connect/:id assignment failed (non-fatal):', e.message);
      }
    }

    let result = { success: false, error: 'Unknown site' };
    const _connectStart = Date.now();
    if (site.includes('cellar')) {
      result = await ctLogin(conn.email, conn.password, conn.user_id, proxyConfig);
    } else if (site.includes('wine')) {
      result = await wsLogin(conn.email, conn.password, conn.user_id, proxyConfig);
    } else {
      return res.status(400).json({ error: 'Unsupported site for connect' });
    }
    const _connectDurationMs = Date.now() - _connectStart;

    // Save fresh cookies on success.
    if (result.success && conn.user_id && result.cookies && result.cookies.length > 0) {
      try {
        await pool.query('DELETE FROM users_sessions WHERE user_id=$1 AND site=$2', [conn.user_id, conn.site_name]);
        await pool.query(
          'INSERT INTO users_sessions(user_id, site, session_cookies, last_used) VALUES($1, $2, $3, now())',
          [conn.user_id, conn.site_name, encryptCookies(conn.user_id, result.cookies)]
        );
      } catch (e) {
        console.warn('[/connect/:id] Could not save session cookies:', e.message);
      }
    }

    // Audit log.
    await logProxyRequest(
      pool, conn.user_id, id, conn.site_name, result.success ? 200 : 401, 'server',
      _connectDurationMs,
      {
        proxy_id:      proxyConfig?.proxy_id      || null,
        proxy_address: proxyConfig?.proxy_address  || null,
        proxy_port:    proxyConfig?.proxy_port     || null,
        country_code:  proxyConfig?.country_code   || null,
        city_name:     proxyConfig?.city_name      || null,
        cookie_count:  result.cookies?.length      ?? null,
        error:         result.success ? null : (result.error || null),
      }
    );

    const now = new Date();
    const updates = [];
    const vals = [];
    if (result.success) {
      updates.push('is_connected = $' + (updates.length + 1)); vals.push(true);
      updates.push('is_error = $' + (updates.length + 1)); vals.push(false);
      updates.push('error_message = $' + (updates.length + 1)); vals.push(null);
      updates.push('last_connected = $' + (updates.length + 1)); vals.push(now);
      updates.push('status = $' + (updates.length + 1)); vals.push('connected');
      const accountUsername = result.username || result.displayName || null;
      if (accountUsername) {
        updates.push('account_username = $' + (updates.length + 1)); vals.push(accountUsername);
      }
    } else {
      updates.push('is_connected = $' + (updates.length + 1)); vals.push(false);
      updates.push('is_error = $' + (updates.length + 1)); vals.push(true);
      updates.push('error_message = $' + (updates.length + 1)); vals.push(result.error || 'Unknown error');
      updates.push('last_connected = $' + (updates.length + 1)); vals.push(now);
      updates.push('status = $' + (updates.length + 1)); vals.push('failed');
    }
    vals.push(id);
    const sql = `UPDATE users_connections SET ${updates.join(', ')}, updated_date = now() WHERE id = $${vals.length} RETURNING *`;
    const u = await pool.query(sql, vals);
    if (u.rows[0]) u.rows[0].password = null; // never return password to client
    return res.json({ success: result.success, error: result.error || null, connection: u.rows[0] });
  } catch (err) {
    console.error('connect endpoint error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Poll logs for a connection job
app.get('/connect/:id/logs', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const logs = jobLogs.get(id) || [];
    return res.json(logs);
  } catch (err) {
    console.error('logs endpoint error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// SSE stream logs for a connection job
app.get('/connect/:id/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  // set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // send existing logs first
  const existing = jobLogs.get(id) || [];
  for (const e of existing) {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  }

  if (!sseSubscribers.has(id)) sseSubscribers.set(id, new Set());
  sseSubscribers.get(id).add(res);

  req.on('close', () => {
    const set = sseSubscribers.get(id);
    if (set) set.delete(res);
  });
});

// SSE stream for lookup batch logs
app.get('/lookup/:id/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  // set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // send existing logs first
  const existing = jobLogs.get(id) || [];
  for (const e of existing) {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  }

  if (!sseSubscribers.has(id)) sseSubscribers.set(id, new Set());
  sseSubscribers.get(id).add(res);

  req.on('close', () => {
    const set = sseSubscribers.get(id);
    if (set) set.delete(res);
  });
});

// List batches for the current user by tab. Token is optional — unauthenticated users will only see demo batches.
app.get('/batches', async (req, res) => {
  const tab = (req.query.tab || 'single').toString();
  // try to parse optional token
  let userId = null;
  try {
    const auth = (req.headers.authorization || req.query.access_token || '').toString();
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.id;
    }
  } catch (e) {
    userId = null;
  }
  try {
    let pattern = '';
    if (tab === 'single') pattern = 'single_%';
    else if (tab === 'paste') pattern = 'list_%';
    else if (tab === 'upload') pattern = 'file_%';
    else if (tab === 'image') pattern = 'image_%';
    else pattern = '%';

    // Include demo batches (batch ids that contain '_demo_') so users without personal history still see demo data
    // Only include non-deleted lookup rows when computing batches
    const uidParam = userId || '00000000-0000-0000-0000-000000000000';
    const sql = `SELECT batch_id, MAX(created_date) as last_date, COUNT(*) as cnt FROM wine_lookups WHERE is_deleted = false AND (user_id=$1 OR batch_id LIKE '%_demo_%') AND batch_id LIKE $2 GROUP BY batch_id ORDER BY last_date DESC LIMIT 50`;
    const r = await pool.query(sql, [uidParam, pattern]);
    const batches = r.rows.map(row => ({ id: row.batch_id, date: row.last_date, count: Number(row.cnt) }));
    const current = batches.length ? batches[0].id : null;
    const history = batches.slice(1).map(b => b.id);
    return res.json({ current, history });
  } catch (err) {
    console.error('batches endpoint error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Return grouped batch history with wines for a tab (grouped by batch_id). Token optional.
app.get('/batches/history', async (req, res) => {
  const tab = (req.query.tab || 'single').toString();
  // try to parse optional token
  let userId = null;
  try {
    const auth = (req.headers.authorization || req.query.access_token || '').toString();
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      const payload = jwt.verify(token, JWT_SECRET);
      userId = payload.id;
    }
  } catch (e) {
    userId = null;
  }
  try {
    let pattern = '';
    if (tab === 'single') pattern = 'single_%';
    else if (tab === 'paste') pattern = 'list_%';
    else if (tab === 'upload') pattern = 'file_%';
    else if (tab === 'image') pattern = 'image_%';
    else pattern = '%';

    const uidParam = userId || '00000000-0000-0000-0000-000000000000';
    const sql = `SELECT * FROM wine_lookups WHERE is_deleted = false AND (user_id=$1 OR batch_id LIKE '%_demo_%') AND batch_id LIKE $2 ORDER BY created_date DESC LIMIT 1000`;
    const r = await pool.query(sql, [uidParam, pattern]);
    // group rows by batch_id
    const groups = {};
    for (const row of r.rows) {
      if (!groups[row.batch_id]) groups[row.batch_id] = { id: row.batch_id, date: row.created_date, wines: [] };
      groups[row.batch_id].wines.push(row);
      // keep latest date for the group
      if (new Date(row.created_date) > new Date(groups[row.batch_id].date)) groups[row.batch_id].date = row.created_date;
    }
    // convert to sorted array by date desc
    const arr = Object.values(groups).sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json(arr);
  } catch (err) {
    console.error('batches history endpoint error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// Trigger server-side lookup for a batch (queued with concurrency limit)
app.post('/lookup/:id/run', authMiddleware, async (req, res) => {
  const batchId = req.params.id;
  const userId = req.user.id;
  const currency = ((req.query.currency || '') || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase() || 'USD';

  // If this batch is already running, return immediately
  if (_lookupRunning.has(batchId)) {
    return res.json({ queued: false, already_running: true });
  }

  // Enforce monthly lookup limit (secondary check — primary is at bulk create)
  if (req.user.role_type !== 'admin') {
    const limitCheck = await checkLookupLimit(userId);
    if (!limitCheck.allowed) {
      return res.status(402).json({
        error: limitCheck.reason,
        upgrade_required: true,
        used: limitCheck.used,
        limit: limitCheck.limit,
        plan: limitCheck.plan,
      });
    }
  }

  // Queue position: how many jobs are waiting ahead
  const position = _lookupWaitQueue.length + (_lookupActiveCount >= LOOKUP_MAX_CONCURRENT ? 1 : 0);

  function logger(msg) {
    const entry = { ts: new Date().toISOString(), msg };
    if (!jobLogs.has(batchId)) jobLogs.set(batchId, []);
    jobLogs.get(batchId).push(entry);
    if (jobLogs.get(batchId).length > 200) jobLogs.set(batchId, jobLogs.get(batchId).slice(-200));
    const subs = sseSubscribers.get(batchId);
    if (subs) for (const r of subs) { try { r.write(`data: ${JSON.stringify(entry)}\n\n`); } catch (e) {} }
  }

  // Count wines in batch for the audit log
  const batchCountR = await pool.query('SELECT COUNT(*) FROM wine_lookups WHERE batch_id=$1 AND is_deleted=false', [batchId]).catch(() => null);
  const wineCount = batchCountR ? parseInt(batchCountR.rows[0].count, 10) : null;
  const batchLookupType = batchIdToLookupType(batchId);
  logActivity(userId, 'wine_lookup_run', { batch_id: batchId, wine_count: wineCount, currency, lookup_type: batchLookupType, mode: 'server' }, req);

  (async () => {
    if (position > 0) logger(`Queued — position ${position + 1} of ${_lookupActiveCount + _lookupWaitQueue.length + 1}`);
    const slot = await _lookupEnqueue(batchId, userId);
    if (slot === 'already_running') return;
    try {
      await pool.query('UPDATE wine_lookups SET ws_currency=$1 WHERE batch_id=$2', [currency, batchId]);
      // Fetch decrypted credentials so runLookupForBatch can auto-re-login if cookies expire
      let creds = {};
      try {
        const credR = await pool.query(
          `SELECT site_name, email, password FROM users_connections WHERE user_id=$1 AND is_connected=true AND is_enabled=true`,
          [userId]
        );
        for (const row of credR.rows) {
          const pwd = decryptText(row.password);
          if (pwd) creds[row.site_name] = { email: row.email, password: pwd };
        }
      } catch (e) { /* non-critical — lookup still runs without auto-reconnect */ }
      await runLookupForBatch(batchId, logger, { currency, creds });
      logger('Lookup finished');
      // Log completion with per-batch error counts for cost/usage analysis
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE ct_error IS NOT NULL AND ct_error <> '') AS ct_errors,
           COUNT(*) FILTER (WHERE ws_error IS NOT NULL AND ws_error <> '') AS ws_errors,
           COUNT(*) FILTER (WHERE (ct_avg IS NOT NULL AND ct_avg <> '') OR (ws_avg IS NOT NULL AND ws_avg <> '')) AS with_results
         FROM wine_lookups WHERE batch_id=$1 AND is_deleted=false`,
        [batchId]
      ).then(r => {
        if (r.rowCount) {
          const s = r.rows[0];
          logActivity(userId, 'lookup_completed', {
            batch_id: batchId, lookup_type: batchLookupType, mode: 'server', currency,
            total: Number(s.total), completed: Number(s.completed),
            ct_errors: Number(s.ct_errors), ws_errors: Number(s.ws_errors),
            with_results: Number(s.with_results),
          });
        }
      }).catch(() => {});
    } catch (e) {
      logger(`Lookup error: ${String(e)}`);
      logActivity(userId, 'lookup_error', { batch_id: batchId, lookup_type: batchLookupType, mode: 'server', error: String(e) });
    } finally {
      _lookupRelease(batchId);
    }
  })();

  return res.json({ queued: true, position });
});

/** Derive the lookup type from the batch_id prefix set by the frontend. */
function batchIdToLookupType(batchId) {
  if (!batchId) return null;
  if (batchId.startsWith('single_')) return 'single';
  if (batchId.startsWith('list_'))   return 'paste';
  if (batchId.startsWith('file_'))   return 'file';
  if (batchId.startsWith('image_'))  return 'image';
  return null;
}

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
// ── Credit refund endpoint ─────────────────────────────────────────────────
// Called by the frontend when a batch completely fails (no results at all).
// Soft-deletes all non-result wine_lookups in the batch so credits are returned.
// Only refunds wines still in 'pending' or 'error' status with no ct_avg/ws_avg,
// i.e. wines that returned zero data.  Wines with actual data are kept.
app.post('/lookup/:id/refund-credits', authMiddleware, async (req, res) => {
  const batchId  = req.params.id;
  const userId   = req.user.id;
  try {
    // Security: verify this batch belongs to the requesting user
    const owned = await pool.query(
      `SELECT COUNT(*) FROM wine_lookups WHERE batch_id=$1 AND user_id=$2 AND is_deleted=false`,
      [batchId, userId]
    );
    if (parseInt(owned.rows[0].count, 10) === 0) {
      return res.status(404).json({ error: 'Batch not found or already deleted' });
    }

    // Soft-delete wines that have zero results (no CT avg AND no WS avg)
    const r = await pool.query(
      `UPDATE wine_lookups
       SET is_deleted=true, deleted_date=now()
       WHERE batch_id=$1
         AND user_id=$2
         AND is_deleted=false
         AND (ct_avg IS NULL OR ct_avg='')
         AND (ws_avg IS NULL OR ws_avg='')
       RETURNING id`,
      [batchId, userId]
    );
    const refunded = r.rowCount || 0;
    console.log(`[credit-refund] Batch ${batchId}: soft-deleted ${refunded} empty result rows for user ${userId}`);
    logActivity(userId, 'lookup_credits_refunded', {
      batch_id: batchId, lookup_type: batchIdToLookupType(batchId), refunded_count: refunded,
    }, req);
    res.json({ ok: true, refunded });
  } catch (err) {
    console.error('[credit-refund] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Queue status — lets frontend show "X jobs ahead of you" ──────────────────
app.get('/lookup/queue', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const pos = _lookupWaitQueue.findIndex(j => j.userId === userId);
  res.json({
    active: _lookupActiveCount,
    max_concurrent: LOOKUP_MAX_CONCURRENT,
    waiting: _lookupWaitQueue.length,
    your_position: pos >= 0 ? pos + 1 : null,
  });
});

app.delete('/entities/:entity/:id', async (req, res) => {
  const { entity, id } = req.params;
  try {
    const user = req.user;
    if (entity === 'WineLookup') {
      const check = await pool.query('SELECT user_id FROM wine_lookups WHERE id=$1', [id]);
      if (check.rowCount === 0) return res.status(404).json({ error: 'Not found' });
      const owner = check.rows[0].user_id;
      if (user.role_type !== 'admin' && String(owner) !== String(user.id)) return res.status(403).json({ error: 'Forbidden' });
      await pool.query('DELETE FROM wine_lookups WHERE id=$1', [id]);
      return res.json({ success: true });
    } else if (entity === 'SiteCredential') {
      const check = await pool.query('SELECT user_id, site_name FROM users_connections WHERE id=$1', [id]);
      if (check.rowCount === 0) return res.status(404).json({ error: 'Not found' });
      const owner    = check.rows[0].user_id;
      const siteName = check.rows[0].site_name;
      if (user.role_type !== 'admin' && owner !== user.id) return res.status(403).json({ error: 'Forbidden' });
      await pool.query('DELETE FROM users_connections WHERE id=$1', [id]);
      await pool.query('DELETE FROM users_sessions    WHERE user_id=$1 AND site=$2', [owner, siteName]);
      // For Wine-Searcher, also delete the per-user Playwright browser profile directory.
      if (siteName === 'wine_searcher') {
        try {
          const { rmSync, existsSync } = await import('fs');
          const __srvDir = pathDirname(pathFileURLToPath(import.meta.url));
          const profileDir = pathJoin(__srvDir, '..', '.ws_browser_profiles', String(owner), 'wine_searcher');
          if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
        } catch (fsErr) {
          console.error('[Disconnect] WS profile dir cleanup (non-fatal):', fsErr.message);
        }
      }
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Unknown entity' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Zod schemas for auth input validation ────────────────────────────────────
const PASSWORD_MSG = 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character';
function validatePasswordStrength(p) {
  if (!p || p.length < 8)      return PASSWORD_MSG;
  if (!/[A-Z]/.test(p))        return PASSWORD_MSG;
  if (!/[a-z]/.test(p))        return PASSWORD_MSG;
  if (!/[0-9]/.test(p))        return PASSWORD_MSG;
  if (!/[^a-zA-Z0-9]/.test(p)) return PASSWORD_MSG;
  return null;
}

const signupSchema = z.object({
  email:     z.string().email('Invalid email').max(254),
  password:  z.string().max(128).refine(p => !validatePasswordStrength(p), { message: PASSWORD_MSG }),
  full_name: z.string().max(100).optional(),
});
const signinSchema = z.object({
  email:    z.string().email('Invalid email').max(254),
  password: z.string().min(1, 'Password required').max(128),
});
const forgotSchema = z.object({
  email: z.string().email('Invalid email').max(254),
});

const LOCKOUT_ATTEMPTS = 10;       // failed attempts before lock
const LOCKOUT_MINUTES  = 30;       // lock duration in minutes

// ── Google OAuth ──────────────────────────────────────────────────────────────
// GET /auth/google — redirect user to Google's OAuth consent screen
app.get('/auth/google', (_req, res) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured.' });
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/google/callback — Google redirects here after user authenticates
app.get('/auth/google/callback', async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback';
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=cancelled`);
  }

  try {
    // Exchange authorization code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=token_failed`);
    }

    // Fetch Google user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await profileRes.json();

    if (!googleUser.email) {
      return res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=no_email`);
    }

    // Find or create user
    let user;
    let googleAuthEvent = 'login_google';
    const byGoogleId = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleUser.id]);
    if (byGoogleId.rows.length > 0) {
      user = byGoogleId.rows[0];
      if (user.is_deleted) {
        return res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=account_deleted`);
      }
      await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
    } else {
      const byEmail = await pool.query('SELECT * FROM users WHERE email = $1', [googleUser.email]);
      if (byEmail.rows.length > 0) {
        user = byEmail.rows[0];
        if (user.is_deleted) {
          return res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=account_deleted`);
        }
        // Link Google account to existing email-based user
        await pool.query(
          'UPDATE users SET google_id = $1, is_email_verified = true, last_login = now() WHERE id = $2',
          [googleUser.id, user.id]
        );
        user.google_id = googleUser.id;
        user.is_email_verified = true;
        googleAuthEvent = 'login_google';
      } else {
        // Create new user (no password — Google-only account)
        const nameFromEmail = (googleUser.email || '').split('@')[0] || null;
        const result = await pool.query(
          `INSERT INTO users (full_name, email, google_id, is_email_verified, last_login, credits_expiry_date)
           VALUES ($1, $2, $3, true, now(), NOW()+INTERVAL '1 month')
           RETURNING *`,
          [googleUser.name || nameFromEmail, googleUser.email, googleUser.id]
        );
        user = result.rows[0];
        googleAuthEvent = 'signup_google';
      }
    }
    logActivity(user.id, googleAuthEvent, { email: googleUser.email, google_id: googleUser.id }, req);

    // Issue JWT + refresh token
    const token = jwt.sign(
      { id: user.id, email: user.email, role_type: user.role_type },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
    const refreshToken = await createRefreshToken(user.id);

    const userPayload = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role_type: user.role_type,
      subscription_plan: user.subscription_plan,
      is_email_verified: user.is_email_verified,
    };

    const callbackParams = new URLSearchParams({
      token,
      refreshToken,
      user: JSON.stringify(userPayload),
    });

    res.redirect(`${FRONTEND_URL}/Authentication?${callbackParams}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`${FRONTEND_URL}/Authentication?mode=signin&oauth_error=server_error`);
  }
});

// Auth endpoints: signup, signin, me
app.post('/auth/signup', authLimiter, async (req, res) => {
  const parse = signupSchema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.errors[0].message });
  const { full_name, email, password } = parse.data;
  try {
    const existing = await pool.query('SELECT id, is_deleted FROM users WHERE email=$1', [email]);
    if (existing.rowCount > 0) {
      if (existing.rows[0].is_deleted) {
        return res.status(410).json({ error: 'This email address belongs to a deleted Burgundy Bid account and cannot be reused.' });
      }
      return res.status(409).json({ error: 'User exists' });
    }
    const hashed = bcrypt.hashSync(password, 10);
    // If full_name not provided or empty, derive it from the email prefix before '@'
    const deriveNameFromEmail = (em) => {
      try {
        if (!em) return null;
        const s = String(em).split('@')[0] || '';
        return s || null;
      } catch (e) { return null; }
    };
    const saveFullName = (full_name && String(full_name).trim()) ? String(full_name).trim() : deriveNameFromEmail(email);
    const verificationCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const sql = `INSERT INTO users(full_name,email,password,email_verification_code,email_verification_expires,credits_expiry_date) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '1 month') RETURNING id,created_date,full_name,email,role_type,phone,subscription_plan`;
    const newUser = await pool.query(sql, [saveFullName, email, hashed, verificationCode, verificationExpires]);
    logActivity(newUser.rows[0].id, 'signup', { email, full_name: saveFullName, method: 'email' }, req);
    // Send verification email non-blocking
    // if (!process.env.RESEND_API_KEY) { // old Resend guard
    //   console.log(`[signup] DEV — verification code for ${email}: ${verificationCode}`);
    // }
    console.log(`[signup] verification code for ${email}: ${verificationCode}`);
    const verifyHtml = emailTemplate(`
      <p style="margin:0 0 12px;">Hi ${saveFullName || 'there'},</p>
      <p style="margin:0 0 24px;color:#555;">Welcome to Burgundy Bid! Use the code below to verify your email address.</p>
      <div style="text-align:center;margin:32px 0;">
        <span style="display:inline-block;font-size:38px;font-weight:700;letter-spacing:12px;
                     color:#800020;font-family:'Courier New',Courier,monospace;
                     background:#fdf5f7;padding:18px 28px;border-radius:8px;
                     border:2px dashed #c0305a;">${verificationCode}</span>
      </div>
      <p style="margin:0 0 8px;color:#555;">Enter this code in the app to complete your sign-up.</p>
      <p style="margin:0;color:#999;font-size:13px;">This code expires in 24 hours.</p>
    `);
    sendEmail(email, 'Verify your Burgundy Bid email', verifyHtml).catch(e =>
      console.error('[signup] Failed to send verification email:', e.message)
    );
    // Don't issue JWT yet — user must verify email first
    return res.json({ verification_required: true, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/auth/signin', authLimiter, async (req, res) => {
  const parse = signinSchema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.errors[0].message });
  const { email, password } = parse.data;
  try {
    const r = await pool.query(
      'SELECT id,created_date,full_name,email,role_type,phone,subscription_plan,password,is_deleted,preferred_theme,is_email_verified,failed_login_attempts,locked_until FROM users WHERE email=$1',
      [email]
    );
    // Return generic error to prevent user enumeration
    if (r.rowCount === 0) return res.status(401).json({ error: 'Invalid email or password' });
    const u = r.rows[0];
    if (u.is_deleted) return res.status(403).json({ error: 'Account inactive' });

    // Check account lockout
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const unlockAt = new Date(u.locked_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return res.status(423).json({ error: `Account temporarily locked due to too many failed attempts. Try again after ${unlockAt}.`, locked: true });
    }

    if (!u.password) {
      return res.status(401).json({ error: 'This account was created with Google. Please sign in with Google instead.' });
    }
    const ok = bcrypt.compareSync(password, u.password);
    if (!ok) {
      // Increment failure count; lock after LOCKOUT_ATTEMPTS
      const newAttempts = (u.failed_login_attempts || 0) + 1;
      if (newAttempts >= LOCKOUT_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        await pool.query('UPDATE users SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3', [newAttempts, lockedUntil, u.id]);
        logActivity(u.id, 'login_failed', { email, reason: 'account_locked', attempts: newAttempts }, req);
      } else {
        await pool.query('UPDATE users SET failed_login_attempts=$1 WHERE id=$2', [newAttempts, u.id]);
        logActivity(u.id, 'login_failed', { email, reason: 'invalid_password', attempts: newAttempts }, req);
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Reset lockout state and record last login on successful password match
    await pool.query(
      'UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1',
      [u.id]
    );
    logActivity(u.id, 'login', { email, method: 'email' }, req);

    if (!u.is_email_verified) {
      // Resend verification code (non-blocking)
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      pool.query('UPDATE users SET email_verification_code=$1, email_verification_expires=$2 WHERE email=$3', [code, expires, email])
        .then(() => {
          const html = emailTemplate(`
            <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">Verify your email address</h2>
            <p style="margin:0 0 24px;color:#555;">Your verification code is:</p>
            <div style="text-align:center;margin:24px 0;">
              <span style="display:inline-block;background:#f4f4f4;border-radius:8px;padding:16px 32px;font-size:32px;font-weight:700;letter-spacing:8px;color:#800020;font-family:monospace;">${code}</span>
            </div>
            <p style="color:#555;">This code expires in 24 hours.</p>
          `);
          return sendEmail(email, 'Verify your Burgundy Bid email', html);
        })
        .catch(e => console.error('[signin] resend verification error:', e));
      return res.status(403).json({ error: 'email_not_verified', email_not_verified: true });
    }
    const user = { id: u.id, created_date: u.created_date, full_name: u.full_name, email: u.email, role_type: u.role_type, phone: u.phone, subscription_plan: u.subscription_plan, preferred_theme: u.preferred_theme };
    const token = jwt.sign({ id: user.id, email: user.email, role_type: user.role_type }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const refreshToken = await createRefreshToken(u.id);
    return res.json({ user, token, refreshToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Refresh access token using a long-lived refresh token
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const userId = await rotateRefreshToken(refreshToken);
    if (!userId) return res.status(401).json({ error: 'Invalid or expired refresh token' });
    const uR = await pool.query(
      'SELECT id,email,role_type,full_name,phone,subscription_plan,preferred_theme,is_deleted,locked_until FROM users WHERE id=$1',
      [userId]
    );
    if (!uR.rowCount) return res.status(401).json({ error: 'User not found' });
    const u = uR.rows[0];
    if (u.is_deleted) return res.status(403).json({ error: 'Account deleted' });
    if (u.locked_until && new Date(u.locked_until) > new Date()) return res.status(423).json({ error: 'Account locked', locked: true });
    const token = jwt.sign({ id: u.id, email: u.email, role_type: u.role_type }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const newRefreshToken = await createRefreshToken(u.id);
    const user = { id: u.id, email: u.email, role_type: u.role_type, full_name: u.full_name, phone: u.phone, subscription_plan: u.subscription_plan, preferred_theme: u.preferred_theme };
    return res.json({ token, refreshToken: newRefreshToken, user });
  } catch (err) {
    console.error('[auth/refresh]', err);
    res.status(500).json({ error: String(err) });
  }
});

// return current user from token
app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const email = req.user.email;
    const r = await pool.query('SELECT id,created_date,updated_date,full_name,email,role_type,phone,subscription_plan,subscription_price,subscription_started,subscription_ended,preferred_theme,is_email_verified,google_id FROM users WHERE email=$1', [email]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Update current user's profile fields
app.put('/auth/me', authMiddleware, async (req, res) => {
  try {
    const email = req.user.email;
    const fields = req.body || {};
    const allowed = ['full_name','phone','preferred_theme','subscription_plan','subscription_price','subscription_started','subscription_ended','is_email_verified'];
    const updates = [];
    const vals = [];
    Object.entries(fields).forEach(([k,v]) => {
      if (allowed.includes(k)) {
        updates.push(`${k} = $${updates.length + 1}`);
        vals.push(v);
      }
    });
    if (updates.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    // set updated_date
    updates.push(`updated_date = now()`);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE email = $${vals.length + 1} RETURNING id,created_date,updated_date,full_name,email,role_type,phone,subscription_plan,subscription_price,subscription_started,subscription_ended,preferred_theme,is_email_verified`;
    vals.push(email);
    const r = await pool.query(sql, vals);
    logActivity(r.rows[0].id, 'profile_updated', { fields_changed: Object.keys(fields).filter(k => Object.prototype.hasOwnProperty.call(fields, k) && ['full_name','phone','preferred_theme'].includes(k)) }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Change current user's password
app.put('/auth/password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    const pwErr = validatePasswordStrength(new_password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const email = req.user.email;
    const r = await pool.query('SELECT password, full_name FROM users WHERE email=$1', [email]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    const { password: hashed, full_name } = r.rows[0];
    const ok = bcrypt.compareSync(current_password || '', hashed);
    if (!ok) return res.status(401).json({ error: 'Invalid current password' });
    const newHash = bcrypt.hashSync(new_password, 10);
    await pool.query('UPDATE users SET password=$1, updated_date = now() WHERE email=$2', [newHash, email]);
    logActivity(req.user.id, 'password_changed', { email }, req);
    // Send security notification (non-blocking)
    const html = emailTemplate(`
      <p style="margin:0 0 12px;">Hi ${full_name || 'there'},</p>
      <p style="margin:0 0 24px;color:#555;">Your Burgundy Bid account password was successfully changed.</p>
      <p style="margin:0 0 8px;color:#555;">If you made this change, no further action is needed.</p>
      <p style="margin:0;color:#999;font-size:13px;">If you did not make this change, please reset your password immediately or contact support at <a href="mailto:support@burgundybid.com" style="color:#800020;">support@burgundybid.com</a>.</p>
    `, 'This is a security notification for your Burgundy Bid account.');
    sendEmail(email, 'Your Burgundy Bid password has been changed', html).catch(e =>
      console.warn('[change-password] Failed to send confirmation email:', e.message)
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Soft-delete current user account
// Flow:
//   1. Revoke all refresh tokens (signs user out everywhere)
//   2. Cancel any active Stripe subscription
//   3. Hard-delete all linked user data (connections, lookups, activity, payments,
//      sessions, tickets, suggestions); ocr_requests.user_id → NULL
//   4. Delete WS browser profile directory from filesystem
//   5. Wipe all PII columns from the users row, keeping only:
//      id, email, full_name, created_date, updated_date, last_login, google_id,
//      is_deleted, deleted_date
app.delete('/auth/me', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    // Log before data is wiped so the audit trail is preserved
    await logActivity(userId, 'account_deleted', { email: req.user.email }, req);

    // 1. Revoke all refresh tokens
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=$1', [userId]);

    // 2. Cancel active Stripe subscriptions
    const uR = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [userId]);
    if (uR.rowCount && uR.rows[0].stripe_customer_id && stripe) {
      try {
        const subs = await stripe.subscriptions.list({ customer: uR.rows[0].stripe_customer_id, status: 'active', limit: 10 });
        for (const sub of subs.data) await stripe.subscriptions.cancel(sub.id);
      } catch (e) {
        console.error('[Delete account] Stripe cancel (non-fatal):', e.message);
      }
    }

    // 3. Hard-delete all linked data
    await pool.query('DELETE FROM users_connections WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM wine_lookups      WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM users_activity    WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM users_payments    WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM users_sessions    WHERE user_id=$1', [userId]);
    await pool.query('UPDATE ocr_requests SET user_id=NULL WHERE user_id=$1', [userId]);
    // support_tickets and suggestions: hard-delete user's own rows
    await pool.query('DELETE FROM support_tickets WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM suggestions     WHERE user_id=$1', [userId]);

    // 4. Delete WS browser profile directory
    try {
      const { rmSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const __dirname = pathDirname(pathFileURLToPath(import.meta.url));
      const profileDir = join(__dirname, '..', '.ws_browser_profiles', userId);
      if (existsSync(profileDir)) rmSync(profileDir, { recursive: true, force: true });
    } catch (fsErr) {
      console.error('[Delete account] Profile dir cleanup (non-fatal):', fsErr.message);
    }

    // 5. Soft-delete: wipe PII, keep audit columns
    await pool.query(`
      UPDATE users SET
        password                  = NULL,
        role_type                 = 'user',
        phone                     = NULL,
        preferred_theme           = NULL,
        subscription_plan         = 'free',
        subscription_price        = 0,
        subscription_started      = NULL,
        subscription_ended        = NULL,
        stripe_customer_id        = NULL,
        subscription_id           = NULL,
        password_reset_token      = NULL,
        password_reset_expires    = NULL,
        is_email_verified         = false,
        email_verification_code   = NULL,
        email_verification_expires= NULL,
        failed_login_attempts     = 0,
        locked_until              = NULL,
        bonus_lookup_credits      = 0,
        bonus_ocr_credits         = 0,
        is_deleted                = true,
        deleted_date              = now(),
        updated_date              = now()
      WHERE id = $1
    `, [userId]);

    return res.json({ success: true });
  } catch (err) {
    console.error('[Delete account] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Forgot password — sends reset link (public; always 200 to avoid user enumeration)
app.post('/auth/forgot-password', authLimiter, async (req, res) => {
  const parse = forgotSchema.safeParse(req.body || {});
  if (!parse.success) return res.status(400).json({ error: parse.error.errors[0].message });
  const { email } = parse.data;
  try {
    const r = await pool.query('SELECT id, full_name FROM users WHERE email=$1 AND is_deleted IS NOT TRUE', [email]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'No account found with that email address. Please check and try again.' });
    const user = r.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query(
      'UPDATE users SET password_reset_token=$1, password_reset_expires=$2 WHERE id=$3',
      [token, expires, user.id]
    );
    logActivity(user.id, 'password_reset_requested', { email }, req);
    const appUrl = process.env.APP_URL || 'https://burgundybid.com';
    const resetLink = `${appUrl}/Authentication?mode=reset&token=${token}`;
    const html = emailTemplate(`
      <p style="margin:0 0 12px;">Hi ${user.full_name || 'there'},</p>
      <p style="margin:0 0 24px;color:#555;">You requested a password reset for your Burgundy Bid account. Click the button below to set a new password.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${resetLink}"
           style="display:inline-block;background:#800020;color:#ffffff;text-decoration:none;
                  padding:14px 40px;border-radius:6px;font-size:16px;font-weight:600;">
          Reset Password
        </a>
      </div>
      <p style="margin:0 0 16px;color:#999;font-size:13px;">
        Button not working? Copy this link into your browser:<br>
        <a href="${resetLink}" style="color:#800020;word-break:break-all;">${resetLink}</a>
      </p>
      <p style="margin:0;color:#999;font-size:13px;">This link expires in <strong>1 hour</strong>.</p>
    `, 'If you didn\'t request a password reset, you can safely ignore this email. Your password will not change.');
    await sendEmail(email, 'Reset your Burgundy Bid password', html);
    return res.json({ success: true });
  } catch (err) {
    console.error('[forgot-password]', err);
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

// Reset password — validates token, sets new password
app.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });
  const pwErr = validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    const r = await pool.query(
      'SELECT id, email, full_name FROM users WHERE password_reset_token=$1 AND password_reset_expires > now() AND is_deleted IS NOT TRUE',
      [token]
    );
    if (r.rowCount === 0) return res.status(400).json({ error: 'Invalid or expired reset token' });
    const { id: userId, email, full_name } = r.rows[0];
    const hashed = bcrypt.hashSync(password, 10);
    await pool.query(
      'UPDATE users SET password=$1, password_reset_token=NULL, password_reset_expires=NULL, updated_date=now() WHERE id=$2',
      [hashed, userId]
    );
    logActivity(userId, 'password_reset_completed', { email }, req);
    // Send confirmation email (non-blocking)
    const confirmHtml = emailTemplate(`
      <p style="margin:0 0 12px;">Hi ${full_name || 'there'},</p>
      <p style="margin:0 0 24px;color:#555;">Your Burgundy Bid account password has been successfully reset.</p>
      <p style="margin:0 0 8px;color:#555;">You can now sign in with your new password.</p>
      <p style="margin:0;color:#999;font-size:13px;">If you did not request this reset, please contact support immediately at <a href="mailto:support@burgundybid.com" style="color:#800020;">support@burgundybid.com</a>.</p>
    `, 'This is a security notification for your Burgundy Bid account.');
    sendEmail(email, 'Your Burgundy Bid password has been reset', confirmHtml).catch(e =>
      console.warn('[reset-password] Failed to send confirmation email:', e.message)
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Send email verification code (auth-required)
app.post('/auth/send-verification', async (req, res) => {
  try {
    // Accept email from body (pre-auth signup flow) or from JWT if already authenticated
    let email = req.body?.email;
    if (!email && req.headers.authorization) {
      try {
        const tok = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(tok, JWT_SECRET);
        email = decoded.email;
      } catch (_) {}
    }
    if (!email) return res.status(400).json({ error: 'email required' });
    const r = await pool.query('SELECT id, full_name, is_email_verified FROM users WHERE email=$1', [email]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    if (r.rows[0].is_email_verified) return res.json({ success: true, already_verified: true });
    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex code
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await pool.query(
      'UPDATE users SET email_verification_code=$1, email_verification_expires=$2 WHERE email=$3',
      [code, expires, email]
    );
    const html = emailTemplate(`
      <p style="margin:0 0 12px;">Hi ${r.rows[0].full_name || 'there'},</p>
      <p style="margin:0 0 24px;color:#555;">Here is your Burgundy Bid email verification code:</p>
      <div style="text-align:center;margin:32px 0;">
        <span style="display:inline-block;font-size:38px;font-weight:700;letter-spacing:12px;
                     color:#800020;font-family:'Courier New',Courier,monospace;
                     background:#fdf5f7;padding:18px 28px;border-radius:8px;
                     border:2px dashed #c0305a;">${code}</span>
      </div>
      <p style="margin:0 0 8px;color:#555;">Enter this code in the app to verify your email address.</p>
      <p style="margin:0;color:#999;font-size:13px;">This code expires in 24 hours.</p>
    `);
    await sendEmail(email, 'Verify your Burgundy Bid email', html);
    return res.json({ success: true });
  } catch (err) {
    console.error('[send-verification]', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// Verify email with code (no auth required — called before JWT is issued)
app.post('/auth/verify-email', async (req, res) => {
  const { code, email: bodyEmail } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  // Accept email from body (pre-auth signup) or JWT header (already authenticated)
  let email = bodyEmail;
  if (!email && req.headers.authorization) {
    try {
      const tok = req.headers.authorization.replace('Bearer ', '');
      const decoded = jwt.verify(tok, JWT_SECRET);
      email = decoded.email;
    } catch (_) {}
  }
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const r = await pool.query(
      'SELECT id, full_name, email, role_type, subscription_plan, created_date, phone, email_verification_code, email_verification_expires, is_email_verified FROM users WHERE email=$1',
      [email]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    const u = r.rows[0];
    if (u.is_email_verified) {
      // Already verified — issue token so they can proceed
      const token = jwt.sign({ id: u.id, email: u.email, role_type: u.role_type }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      const refreshToken = await createRefreshToken(u.id);
      const { email_verification_code, email_verification_expires, ...safeUser } = u;
      return res.json({ success: true, already_verified: true, user: safeUser, token, refreshToken });
    }
    if (!u.email_verification_code || u.email_verification_code !== code.trim().toUpperCase()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    if (new Date(u.email_verification_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired. Request a new one.' });
    }
    await pool.query(
      'UPDATE users SET is_email_verified=true, email_verification_code=NULL, email_verification_expires=NULL, last_login=NOW(), updated_date=now() WHERE email=$1',
      [email]
    );
    logActivity(u.id, 'email_verified', { email }, req);
    const token = jwt.sign({ id: u.id, email: u.email, role_type: u.role_type }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    const refreshToken = await createRefreshToken(u.id);
    const { email_verification_code, email_verification_expires, ...safeUser } = u;
    return res.json({ success: true, user: { ...safeUser, is_email_verified: true }, token, refreshToken });
  } catch (err) {
    console.error('[verify-email]', err);
    res.status(500).json({ error: String(err) });
  }
});

// Public read-only entity access for demo data (allows unauthenticated clients to fetch demo batches)
app.get('/public/entities/:entity', async (req, res) => {
  const { entity } = req.params;
  const q = req.query;
    try {
    if (entity === 'WineLookup') {
      const { batch_id, limit = 200 } = q;
      if (!batch_id) return res.json([]);
      const includeDeleted = q.include_deleted === 'true' || q.include_deleted === '1';
      const deletedClause = includeDeleted ? '' : 'AND is_deleted = false';
      const sql = `SELECT * FROM wine_lookups WHERE batch_id=$1 ${deletedClause} ORDER BY created_date DESC LIMIT $2`;
      const r = await pool.query(sql, [batch_id, Number(limit)]);
      return res.json(r.rows);
    }
    return res.status(404).json({ error: 'Unknown public entity' });
  } catch (err) {
    console.error('public entity error', err);
    return res.status(500).json({ error: String(err) });
  }
});

// ── Subscription & Stripe endpoints ─────────────────────────────────────────

// Public plan list — used by frontend to build the pricing UI from DB values
app.get('/plans', async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT plan_name, display_name, monthly_lookup_limit, monthly_price_cents, annual_price_cents, monthly_ocr_limit, features
       FROM wine_subscriptions
       ORDER BY COALESCE(NULLIF(monthly_price_cents, 0), annual_price_cents) ASC NULLS FIRST`
    );
    return res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Current usage for authenticated user
app.get('/subscription/usage', authMiddleware, async (req, res) => {
  try {
    const check = await checkLookupLimit(req.user.id);
    const expiryDate = check.credits_expiry_date;
    const daysUntilExpiry = expiryDate
      ? Math.ceil((new Date(expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
      : null;
    return res.json({
      plan: check.plan,
      used: check.used,
      limit: check.limit,
      remaining: check.remaining,
      percent: check.limit > 0 ? Math.round((check.used / check.limit) * 100) : 0,
      bonus_lookup_credits: check.bonus_lookup_credits || 0,
      credits_expiry_date: expiryDate || null,
      days_until_expiry: daysUntilExpiry,
      credits_expired: check.credits_expired || false,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// AI Image Search (OCR) credit usage for authenticated user
app.get('/subscription/ocr-usage', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const uR = await pool.query('SELECT subscription_plan, role_type, bonus_ocr_credits, credits_expiry_date FROM users WHERE id=$1', [userId]);
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const plan = normalizePlan(uR.rows[0].subscription_plan);
    const isAdmin = uR.rows[0].role_type === 'admin';
    const isFree = plan === 'free';
    const bonusOcr = parseInt(uR.rows[0].bonus_ocr_credits || 0, 10);
    const creditsExpiryDate = uR.rows[0].credits_expiry_date;

    // Credits expired — report 0 remaining
    if (!isAdmin && creditsExpiryDate && new Date(creditsExpiryDate) < new Date()) {
      return res.json({ used: 0, limit: 0, remaining: 0, plan, bonus_ocr_credits: bonusOcr, credits_expired: true, credits_expiry_date: creditsExpiryDate });
    }

    // Free plan: count all-time OCR usage (credits are lifetime, not monthly)
    const usedQuery = (isAdmin || !isFree)
      ? pool.query(
          `SELECT COUNT(*) AS used FROM ocr_requests WHERE user_id=$1 AND status='success' AND created_date >= date_trunc('month', NOW())`,
          [userId]
        )
      : pool.query(
          `SELECT COUNT(*) AS used FROM ocr_requests WHERE user_id=$1 AND status='success'`,
          [userId]
        );
    const [limitR, usedR] = await Promise.all([
      pool.query('SELECT monthly_ocr_limit FROM wine_subscriptions WHERE plan_name=$1', [plan]),
      usedQuery,
    ]);
    const baseOcrLimit = isAdmin ? 99999 : parseInt(limitR.rows[0]?.monthly_ocr_limit ?? 2, 10);
    const limit = isAdmin ? 99999 : baseOcrLimit + bonusOcr;
    const used  = parseInt(usedR.rows[0].used, 10);
    const daysUntilExpiry = creditsExpiryDate
      ? Math.ceil((new Date(creditsExpiryDate) - new Date()) / (1000 * 60 * 60 * 24))
      : null;
    res.json({ used, limit, remaining: Math.max(0, limit - used), plan, bonus_ocr_credits: bonusOcr, credits_expiry_date: creditsExpiryDate || null, days_until_expiry: daysUntilExpiry });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Create Stripe Checkout session — redirects user to Stripe's hosted checkout page
app.post('/stripe/create-checkout-session', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on this server' });
  const { plan } = req.body || {};
  const VALID_PLANS = ['basic_monthly', 'basic_annually', 'pro_monthly', 'pro_annually'];
  if (!plan || !VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan. Valid values: ${VALID_PLANS.join(', ')}.` });
  }

  try {
    const priceId = await getOrCreateStripePrice(plan);

    // Get or create Stripe customer for this user
    const uR = await pool.query('SELECT email, full_name, stripe_customer_id FROM users WHERE id=$1', [req.user.id]);
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = uR.rows[0];
    let customerId = u.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: u.email,
        name: u.full_name || undefined,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.user.id]);
    }

    // ── Pre-checkout cleanup ──────────────────────────────────────────────────
    // 1. Cancel any Stripe subscriptions still in `incomplete` status so they
    //    don't ghost the new checkout or confuse the webhook.
    // 2. If the DB shows a paid plan but Stripe has no active subscription
    //    (e.g. a previous failed payment incorrectly activated the plan), reset
    //    the user back to free so the plan cards render correctly.
    try {
      const incompleteSubs = await stripe.subscriptions.list({
        customer: customerId, status: 'incomplete', limit: 10,
      });
      for (const sub of incompleteSubs.data) {
        await stripe.subscriptions.cancel(sub.id);
        console.log(`[Stripe] Cancelled incomplete sub ${sub.id} for user ${req.user.id}`);
      }

      const dbPlanR = await pool.query('SELECT subscription_plan FROM users WHERE id=$1', [req.user.id]);
      const dbPlan  = dbPlanR.rows[0]?.subscription_plan || 'free';
      if (dbPlan !== 'free' && dbPlan !== 'admin') {
        const activeSubs = await stripe.subscriptions.list({
          customer: customerId, status: 'active', limit: 1,
        });
        if (!activeSubs.data.length) {
          await pool.query(
            `UPDATE users SET subscription_plan='free', subscription_id=NULL,
             subscription_renewal_date=NULL, subscription_ended=NULL, credits_reset_date=NULL
             WHERE id=$1`,
            [req.user.id]
          );
          console.log(`[Stripe] Reset stale plan '${dbPlan}' → free for user ${req.user.id} (no active Stripe sub)`);
        }
      }
    } catch (e) {
      console.warn('[Stripe] Pre-checkout cleanup (non-fatal):', e.message);
    }

    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${FRONTEND_URL}/profile?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/profile?subscription=cancelled`,
      metadata: { user_id: req.user.id, plan },
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.error('[Stripe] create-checkout-session error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Stripe webhook — handles subscription lifecycle events
app.post('/stripe/webhook', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      // Always verify signature when STRIPE_WEBHOOK_SECRET is set
      if (!sig) return res.status(400).send('Webhook Error: missing stripe-signature header');
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else if (process.env.NODE_ENV !== 'production') {
      // Only allow unverified events in non-production environments
      event = JSON.parse(req.body.toString());
    } else {
      // In production without a webhook secret configured, reject all webhook calls
      console.error('[Stripe] STRIPE_WEBHOOK_SECRET is not set in production — rejecting webhook');
      return res.status(500).send('Webhook Error: server misconfiguration');
    }
  } catch (e) {
    console.error('[Stripe] Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  // Shared helper: activate a subscription after confirmed payment
  async function activateSubscription(session) {
    const userId = session.metadata?.user_id;
    const plan   = session.metadata?.plan;
    if (!userId || !plan) return;

    const billingInterval = plan.endsWith('_annually') ? 'annual' : 'monthly';
    let renewalDate = null;
    let stripeSubId = session.subscription || null;

    // Verify the Stripe subscription is genuinely active before writing anything
    if (stripeSubId) {
      try {
        const sub = await stripe.subscriptions.retrieve(stripeSubId);
        if (sub.status === 'active' || sub.status === 'trialing') {
          renewalDate = new Date(sub.current_period_end * 1000).toISOString();
        } else {
          // Subscription not active — do not activate in DB
          console.warn(`[Stripe] activateSubscription skipped: sub ${stripeSubId} status=${sub.status}`);
          return;
        }
      } catch (e) {
        console.warn('[Stripe] activateSubscription sub.retrieve failed:', e.message);
        return; // Can't confirm — bail out safely
      }
    }

    await pool.query(
      `UPDATE users SET subscription_plan=$1, subscription_started=now(), subscription_ended=null,
       credits_reset_date=now(), credits_expiry_date=null, subscription_renewal_date=$3, subscription_id=$4 WHERE id=$2`,
      [plan, userId, renewalDate, stripeSubId]
    );
    console.log(`[Stripe] Subscription activated: user=${userId} plan=${plan} interval=${billingInterval}`);

    // Record confirmed payment — only after successful activation
    try {
      await pool.query(
        `INSERT INTO users_payments(user_id,amount,currency,payment_method,payment_status,transaction_id,billing_interval)
         VALUES($1,$2,'usd','stripe','completed',$3,$4)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [userId, (session.amount_total || 0) / 100, session.id, billingInterval]
      );
    } catch (e) { console.warn('[Stripe] Payment record insert (non-fatal):', e.message); }

    logActivity(userId, 'subscription_activated', {
      plan, billing_interval: billingInterval,
      amount_usd: (session.amount_total || 0) / 100,
      stripe_session_id: session.id,
    });

    // Cancel any other active subscriptions — the new one is now the source of truth
    if (session.customer && stripeSubId) {
      try {
        const otherSubs = await stripe.subscriptions.list({
          customer: session.customer, status: 'active', limit: 10,
        });
        for (const oldSub of otherSubs.data) {
          if (oldSub.id !== stripeSubId) {
            await stripe.subscriptions.cancel(oldSub.id);
            console.log(`[Stripe] Cancelled superseded sub ${oldSub.id} for user ${userId}`);
          }
        }
      } catch (e) {
        console.warn('[Stripe] Superseded sub cleanup (non-fatal):', e.message);
      }
    }
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // Only activate when payment is confirmed synchronously.
      // Async payment methods (bank transfers, etc.) fire async_payment_succeeded later.
      if (session.payment_status === 'paid') {
        await activateSubscription(session);
      }
    }

    // Async payment methods (e.g. SEPA, bank transfer) — activate on success
    if (event.type === 'checkout.session.async_payment_succeeded') {
      await activateSubscription(event.data.object);
    }

    // Async payment failed — log it; plan stays on free (was never activated)
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      if (userId) {
        logActivity(userId, 'subscription_payment_failed', {
          stripe_session_id: session.id,
          plan: session.metadata?.plan,
          reason: 'async_payment_failed',
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const r = await pool.query('SELECT id, subscription_id FROM users WHERE stripe_customer_id=$1', [sub.customer]);
      if (r.rowCount) {
        const userId = r.rows[0].id;
        // If another active subscription exists (e.g. user already upgraded), don't reset
        const remaining = await stripe.subscriptions.list({
          customer: sub.customer, status: 'active', limit: 1,
        });
        if (!remaining.data.length) {
          // credits_expiry_date was set at cancellation time — preserve it so the user
          // retains access until the period they paid for
          await pool.query(
            `UPDATE users SET subscription_plan='free', subscription_ended=now(),
             subscription_id=NULL, subscription_renewal_date=NULL WHERE id=$1`,
            [userId]
          );
          console.log(`[Stripe] Subscription deleted — user ${userId} reverted to free`);
        } else {
          console.log(`[Stripe] Sub ${sub.id} deleted but user ${userId} has another active sub — skipping free reset`);
        }
        logActivity(userId, 'subscription_cancelled', { stripe_subscription_id: sub.id, reason: sub.cancellation_details?.reason || null });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      if (sub.status === 'active') {
        const r = await pool.query('SELECT id FROM users WHERE stripe_customer_id=$1', [sub.customer]);
        if (r.rowCount) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          if (priceId) {
            const planR = await pool.query(
              'SELECT plan_name FROM wine_subscriptions WHERE stripe_price_id=$1',
              [priceId]
            );
            if (planR.rowCount) {
              const newPlan = planR.rows[0].plan_name;
              const renewalDate = sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString() : null;
              await pool.query(
                `UPDATE users SET subscription_plan=$1, subscription_started=now(),
                 subscription_renewal_date=$2, subscription_id=$3 WHERE id=$4`,
                [newPlan, renewalDate, sub.id, r.rows[0].id]
              );
              logActivity(r.rows[0].id, 'subscription_updated', { new_plan: newPlan, subscription_id: sub.id });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[Stripe] Webhook processing error:', e);
    return res.status(500).json({ error: String(e) });
  }

  res.json({ received: true });
});

// Verify checkout session after redirect — activates subscription when webhook is delayed
app.get('/stripe/verify-session', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const plan = session.metadata?.plan;
    const userId = session.metadata?.user_id;

    // Security: ensure the session belongs to this user
    if (String(userId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    if (plan) {
      let renewalDate = null;
      let confirmedSubId = null;
      if (session.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          if (sub.status === 'active' || sub.status === 'trialing') {
            renewalDate = new Date(sub.current_period_end * 1000).toISOString();
            confirmedSubId = sub.id;
          } else {
            // Payment marked paid but sub not yet active — do not activate
            return res.status(400).json({ error: 'Subscription not yet active. Please wait a moment and refresh.' });
          }
        } catch (e) {
          console.warn('[Stripe] verify-session sub.retrieve:', e.message);
          return res.status(500).json({ error: 'Could not verify subscription status. Please contact support.' });
        }
      }

      // Idempotent: avoid double-inserting payment if webhook already did it
      const existing = await pool.query(
        'SELECT id FROM users_payments WHERE transaction_id=$1', [session.id]
      );
      if (!existing.rowCount) {
        const billingInterval = plan.endsWith('_annually') ? 'annual' : 'monthly';
        try {
          await pool.query(
            `INSERT INTO users_payments(user_id,amount,currency,payment_method,payment_status,transaction_id,billing_interval)
             VALUES($1,$2,'usd','stripe','completed',$3,$4)
             ON CONFLICT (transaction_id) DO NOTHING`,
            [userId, (session.amount_total || 0) / 100, session.id, billingInterval]
          );
        } catch (e) { /* non-fatal */ }
      }

      await pool.query(
        `UPDATE users SET subscription_plan=$1, subscription_started=now(), subscription_ended=null,
         credits_reset_date=now(), credits_expiry_date=null, subscription_renewal_date=$3, subscription_id=$4 WHERE id=$2`,
        [plan, userId, renewalDate, confirmedSubId]
      );

      // Cancel any other active subscriptions — the newly confirmed one takes over
      if (confirmedSubId) {
        try {
          const sessionData = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer'] });
          const customerId = typeof sessionData.customer === 'string' ? sessionData.customer : sessionData.customer?.id;
          if (customerId) {
            const otherSubs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 });
            for (const oldSub of otherSubs.data) {
              if (oldSub.id !== confirmedSubId) {
                await stripe.subscriptions.cancel(oldSub.id);
                console.log(`[Stripe] verify-session: cancelled superseded sub ${oldSub.id} for user ${userId}`);
              }
            }
          }
        } catch (e) {
          console.warn('[Stripe] verify-session superseded sub cleanup (non-fatal):', e.message);
        }
      }
    }

    const uR = await pool.query('SELECT id,email,subscription_plan,subscription_started FROM users WHERE id=$1', [userId]);
    return res.json({ success: true, plan, user: uR.rows[0] });
  } catch (e) {
    console.error('[Stripe] verify-session error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Create Stripe billing portal session (lets users manage/cancel their subscription)
app.post('/stripe/billing-portal', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const uR = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [req.user.id]);
    if (!uR.rowCount || !uR.rows[0].stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found. Please subscribe first.' });
    }
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const portal = await stripe.billingPortal.sessions.create({
      customer: uR.rows[0].stripe_customer_id,
      return_url: `${FRONTEND_URL}/profile`,
    });
    return res.json({ url: portal.url });
  } catch (e) {
    console.error('[Stripe] billing-portal error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// Current subscription details — plan, interval, renewal date, payment method, cancel status
app.get('/subscription/details', authMiddleware, async (req, res) => {
  try {
    const uR = await pool.query(
      `SELECT subscription_plan, subscription_started, subscription_ended,
              subscription_renewal_date, stripe_customer_id, subscription_id, credits_expiry_date
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = uR.rows[0];
    const rawPlan = u.subscription_plan || 'free';
    const interval = rawPlan.endsWith('_annually') ? 'annually' : rawPlan === 'free' ? 'none' : 'monthly';

    let renewalDate = u.subscription_renewal_date || null;
    let cancelAtPeriodEnd = false;
    let paymentMethod = null;
    let stripeSubId = u.subscription_id || null;

    if (stripe && u.stripe_customer_id) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: u.stripe_customer_id, status: 'active', limit: 10,
        });
        if (subs.data.length) {
          // Prefer the subscription matching our stored ID; fall back to the most recent one
          const sub = subs.data.find(s => s.id === stripeSubId) || subs.data[0];
          stripeSubId = sub.id;
          renewalDate = new Date(sub.current_period_end * 1000).toISOString();
          cancelAtPeriodEnd = sub.cancel_at_period_end;
          // Store renewal date in DB for next time
          await pool.query(
            'UPDATE users SET subscription_renewal_date=$1, subscription_id=$2 WHERE id=$3',
            [renewalDate, stripeSubId, req.user.id]
          );
        }
        // Fetch saved payment method
        const pmList = await stripe.paymentMethods.list({
          customer: u.stripe_customer_id, type: 'card', limit: 1,
        });
        if (pmList.data.length) {
          const pm = pmList.data[0].card;
          paymentMethod = { brand: pm.brand, last4: pm.last4, exp_month: pm.exp_month, exp_year: pm.exp_year };
        }
      } catch (e) {
        console.warn('[subscription/details] Stripe fetch (non-fatal):', e.message);
      }
    }

    return res.json({
      plan: rawPlan,
      interval,
      renewal_date: renewalDate,
      cancel_at_period_end: cancelAtPeriodEnd,
      subscription_started: u.subscription_started,
      subscription_ended: u.subscription_ended,
      credits_expiry_date: u.credits_expiry_date || null,
      payment_method: paymentMethod,
    });
  } catch (e) {
    console.error('[subscription/details]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Cancel subscription at end of current period
app.post('/stripe/cancel-subscription', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const uR = await pool.query('SELECT stripe_customer_id, subscription_id FROM users WHERE id=$1', [req.user.id]);
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = uR.rows[0];
    if (!u.stripe_customer_id) return res.status(400).json({ error: 'No active subscription found' });

    // Cancel ALL active subscriptions at period end — there should only be one after our
    // activation cleanup, but handle legacy multi-sub state gracefully
    const allSubs = await stripe.subscriptions.list({
      customer: u.stripe_customer_id, status: 'active', limit: 10,
    });
    if (!allSubs.data.length) return res.status(400).json({ error: 'No active subscription found' });

    let latestPeriodEnd = 0;
    let primarySubId = null;
    for (const sub of allSubs.data) {
      const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      if (updated.current_period_end > latestPeriodEnd) {
        latestPeriodEnd = updated.current_period_end;
        primarySubId = sub.id;
      }
    }

    const cancelDate = new Date(latestPeriodEnd * 1000).toISOString();

    // Record expiry date so the UI can show "credits remain until X" immediately
    await pool.query(
      'UPDATE users SET subscription_id=$1, credits_expiry_date=$2 WHERE id=$3',
      [primarySubId, cancelDate, req.user.id]
    );

    logActivity(req.user.id, 'subscription_cancelled', { stripe_subscription_id: primarySubId, cancel_at: cancelDate, mode: 'end_of_period' });
    return res.json({ success: true, cancel_at: cancelDate });
  } catch (e) {
    console.error('[cancel-subscription]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Helper: compare plan tiers for upgrade vs downgrade detection
const PLAN_TIER = { free: 0, basic_monthly: 1, basic_annually: 2, pro_monthly: 3, pro_annually: 4 };
function planTier(name) { return PLAN_TIER[normalizePlan(name)] ?? 0; }

// Preview the prorated charge for switching to a new plan mid-cycle
app.get('/stripe/upgrade-preview', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { plan } = req.query;
  const VALID_PLANS = ['basic_monthly', 'basic_annually', 'pro_monthly', 'pro_annually'];
  if (!plan || !VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  try {
    const uR = await pool.query(
      'SELECT stripe_customer_id, subscription_id, subscription_plan FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = uR.rows[0];
    if (!u.stripe_customer_id) return res.json({ no_subscription: true });

    let activeSub = null;
    if (u.subscription_id) {
      try { activeSub = await stripe.subscriptions.retrieve(u.subscription_id); } catch (e) {}
    }
    if (!activeSub || !['active', 'trialing'].includes(activeSub.status)) {
      const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'active', limit: 1 });
      activeSub = subs.data[0] || null;
    }
    if (!activeSub) return res.json({ no_subscription: true });

    const priceId = await getOrCreateStripePrice(plan);
    const currentPlan = normalizePlan(u.subscription_plan);
    const isUpgrade = planTier(plan) > planTier(currentPlan);

    const upcoming = await stripe.invoices.retrieveUpcoming({
      customer: u.stripe_customer_id,
      subscription: activeSub.id,
      subscription_items: [{ id: activeSub.items.data[0].id, price: priceId }],
      subscription_proration_behavior: 'always_invoice',
    });

    return res.json({
      amount_due: upcoming.amount_due / 100,
      currency: upcoming.currency.toUpperCase(),
      is_upgrade: isUpgrade,
      current_plan: currentPlan,
      new_plan: plan,
      period_end: new Date(activeSub.current_period_end * 1000).toISOString(),
    });
  } catch (e) {
    console.error('[upgrade-preview]', e);
    res.status(500).json({ error: String(e) });
  }
});

// Upgrade or downgrade an existing paid subscription
app.post('/stripe/update-subscription', authMiddleware, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  const { plan } = req.body || {};
  const VALID_PLANS = ['basic_monthly', 'basic_annually', 'pro_monthly', 'pro_annually'];
  if (!plan || !VALID_PLANS.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan. Valid values: ${VALID_PLANS.join(', ')}.` });
  }

  try {
    const uR = await pool.query(
      'SELECT email, full_name, stripe_customer_id, subscription_id, subscription_plan FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!uR.rowCount) return res.status(404).json({ error: 'User not found' });
    const u = uR.rows[0];

    // No Stripe customer or no active sub → redirect to new checkout
    if (!u.stripe_customer_id) return res.json({ redirect_to_checkout: true });

    let subId = u.subscription_id;
    let activeSub = null;
    if (subId) {
      try { activeSub = await stripe.subscriptions.retrieve(subId); } catch (e) { subId = null; }
    }
    if (!activeSub || activeSub.status !== 'active') {
      const subs = await stripe.subscriptions.list({ customer: u.stripe_customer_id, status: 'active', limit: 1 });
      if (!subs.data.length) return res.json({ redirect_to_checkout: true });
      activeSub = subs.data[0];
      subId = activeSub.id;
    }

    const currentPlan = normalizePlan(u.subscription_plan);
    const isUpgrade = planTier(plan) > planTier(currentPlan);
    const priceId = await getOrCreateStripePrice(plan);

    // Update Stripe subscription
    const updatedSub = await stripe.subscriptions.update(subId, {
      items: [{ id: activeSub.items.data[0].id, price: priceId }],
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
      cancel_at_period_end: false, // clear any pending cancellation
    });

    const renewalDate = new Date(updatedSub.current_period_end * 1000).toISOString();

    if (isUpgrade) {
      // Immediate: activate new plan and reset credits
      await pool.query(
        `UPDATE users
         SET subscription_plan=$1, subscription_started=now(),
             subscription_ended=null, credits_reset_date=now(),
             subscription_id=$2, subscription_renewal_date=$3
         WHERE id=$4`,
        [plan, subId, renewalDate, req.user.id]
      );
    } else {
      // Downgrade: plan switch happens at period end via webhook; just update renewal info
      await pool.query(
        `UPDATE users SET subscription_id=$1, subscription_renewal_date=$2 WHERE id=$3`,
        [subId, renewalDate, req.user.id]
      );
    }

    const billingInterval = plan.endsWith('_annually') ? 'annual' : 'monthly';
    logActivity(req.user.id, 'subscription_updated', {
      old_plan: currentPlan, new_plan: plan,
      is_upgrade: isUpgrade, billing_interval: billingInterval,
    });
    return res.json({ success: true, is_upgrade: isUpgrade, renewal_date: renewalDate });
  } catch (e) {
    console.error('[update-subscription]', e);
    res.status(500).json({ error: String(e) });
  }
});

// ── Invoice / payment history ────────────────────────────────────────────────
app.get('/invoices', authMiddleware, async (req, res) => {
  try {
    const dbR = await pool.query(
      `SELECT id, amount, currency, payment_method, payment_status, transaction_id, created_date, billing_interval
       FROM users_payments WHERE user_id=$1 ORDER BY created_date DESC LIMIT 100`,
      [req.user.id]
    );
    const dbInvoices = dbR.rows.map(r => ({
      id: r.id,
      source: 'payment',
      date: r.created_date,
      amount: r.amount,
      currency: r.currency || 'usd',
      method: r.payment_method,
      status: r.payment_status,
      reference: r.transaction_id,
      billing_interval: r.billing_interval || null,
      description: 'Subscription payment',
    }));

    // Also fetch Stripe invoices if configured
    let stripeInvoices = [];
    if (stripe) {
      try {
        const uR = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [req.user.id]);
        const custId = uR.rows[0]?.stripe_customer_id;
        if (custId) {
          const list = await stripe.invoices.list({ customer: custId, limit: 50 });
          stripeInvoices = list.data.map(inv => {
            const stripeInterval = inv.lines?.data?.[0]?.price?.recurring?.interval;
            const billingInterval = stripeInterval === 'year' ? 'annual' : stripeInterval === 'month' ? 'monthly' : null;
            return {
              id: inv.id,
              source: 'stripe',
              date: new Date(inv.created * 1000).toISOString(),
              amount: (inv.amount_paid || 0) / 100,
              currency: inv.currency || 'usd',
              method: 'stripe',
              status: inv.status,
              reference: inv.number || inv.id,
              billing_interval: billingInterval,
              description: inv.lines?.data?.[0]?.description || 'Subscription',
              invoice_url: inv.hosted_invoice_url,
              invoice_pdf: inv.invoice_pdf,
            };
          });
        }
      } catch (e) {
        console.warn('[invoices] Stripe fetch failed:', e.message);
      }
    }

    // Merge: prefer Stripe invoices when transaction_id matches Stripe invoice id
    const stripeIds = new Set(stripeInvoices.map(i => i.id));
    const mergedDb = dbInvoices.filter(d => !stripeIds.has(d.reference));
    const all = [...stripeInvoices, ...mergedDb].sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json(all);
  } catch (err) {
    console.error('[invoices]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Public contact form ──────────────────────────────────────────────────────
app.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const csR = await pool.query(
      `INSERT INTO contact_submissions(name,email,subject,message) VALUES($1,$2,$3,$4) RETURNING id`,
      [name.trim(), email.trim(), subject.trim(), message.trim()]
    );
    // Log activity — user_id may be null for unauthenticated visitors
    const contactUserId = req.user?.id || null;
    logActivity(contactUserId, 'contact_submitted', { submission_id: csR.rows[0].id, name: name.trim(), email: email.trim(), subject: subject.trim() }, req);
    // Notify via email (non-blocking)
    const html = emailTemplate(`
      <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a1a;">New Contact Form Submission</h2>
      <p><strong>From:</strong> ${name} &lt;${email}&gt;</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:6px;">${message}</p>
    `);
    sendEmail(process.env.CONTACT_EMAIL || email, `Contact: ${subject}`, html).catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    console.error('[contact]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Support tickets ──────────────────────────────────────────────────────────
// Create a new ticket
app.post('/support/tickets', authMiddleware, async (req, res) => {
  const { title, category = 'general', description, priority = 'normal' } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title and description required' });
  try {
    const r = await pool.query(
      `INSERT INTO support_tickets(user_id,title,category,description,priority)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, title.trim(), category, description.trim(), priority]
    );
    logActivity(req.user.id, 'support_ticket_created', { ticket_id: r.rows[0].id, title: title.trim(), category, priority }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    console.error('[support/tickets POST]', err);
    res.status(500).json({ error: String(err) });
  }
});

// List user's own tickets (hide deleted), include replies
app.get('/support/tickets', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM support_tickets WHERE user_id=$1 AND (is_deleted IS NULL OR is_deleted = false) AND (status IS NULL OR status != 'closed') ORDER BY created_date DESC`,
      [req.user.id]
    );
    const tickets = r.rows;
    if (tickets.length === 0) return res.json([]);
    const ids = tickets.map(t => t.id);
    const repliesR = await pool.query(
      `SELECT * FROM ticket_replies WHERE ticket_id = ANY($1) ORDER BY created_date ASC`,
      [ids]
    );
    const repliesByTicket = {};
    for (const reply of repliesR.rows) {
      if (!repliesByTicket[reply.ticket_id]) repliesByTicket[reply.ticket_id] = [];
      repliesByTicket[reply.ticket_id].push(reply);
    }
    return res.json(tickets.map(t => ({ ...t, replies: repliesByTicket[t.id] || [] })));
  } catch (err) {
    console.error('[support/tickets GET]', err);
    res.status(500).json({ error: String(err) });
  }
});

// User: add a reply to own ticket
app.post('/support/tickets/:id/reply', authMiddleware, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body required' });
  try {
    // Verify ticket belongs to user and is not closed
    const tR = await pool.query(
      `SELECT id, status FROM support_tickets WHERE id=$1 AND user_id=$2 AND (is_deleted IS NULL OR is_deleted=false)`,
      [req.params.id, req.user.id]
    );
    if (!tR.rowCount) return res.status(404).json({ error: 'Not found' });
    if (tR.rows[0].status === 'closed') return res.status(403).json({ error: 'Ticket is closed' });
    const uR = await pool.query('SELECT full_name, email FROM users WHERE id=$1', [req.user.id]);
    const u = uR.rows[0] || {};
    await pool.query(
      `UPDATE support_tickets SET updated_date=now() WHERE id=$1`,
      [req.params.id]
    );
    const r = await pool.query(
      `INSERT INTO ticket_replies(ticket_id, author_type, author_name, author_email, body)
       VALUES($1,'user',$2,$3,$4) RETURNING *`,
      [req.params.id, u.full_name || '', u.email || '', body.trim()]
    );
    logActivity(req.user.id, 'support_ticket_replied', { ticket_id: req.params.id }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    console.error('[support/tickets reply]', err);
    res.status(500).json({ error: String(err) });
  }
});

// User: soft-delete own ticket
app.delete('/support/tickets/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE support_tickets SET is_deleted=true, deleted_date=now(), updated_date=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'support_ticket_deleted', { ticket_id: req.params.id }, req);
    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get single ticket
app.get('/support/tickets/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Close a ticket
app.patch('/support/tickets/:id/close', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE support_tickets SET status='closed', closed_at=now(), updated_date=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'support_ticket_closed', { ticket_id: req.params.id }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Suggestions ──────────────────────────────────────────────────────────────
// Submit a suggestion
app.post('/suggestions', authMiddleware, async (req, res) => {
  const { title, category = 'feature', description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'title and description required' });
  try {
    const r = await pool.query(
      `INSERT INTO suggestions(user_id,title,category,description) VALUES($1,$2,$3,$4) RETURNING *`,
      [req.user.id, title.trim(), category, description.trim()]
    );
    logActivity(req.user.id, 'suggestion_created', { suggestion_id: r.rows[0].id, title: title.trim(), category }, req);
    return res.json(r.rows[0]);
  } catch (err) {
    console.error('[suggestions POST]', err);
    res.status(500).json({ error: String(err) });
  }
});

// List user's own suggestions (hide deleted)
app.get('/suggestions', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM suggestions WHERE user_id=$1 AND (is_deleted IS NULL OR is_deleted = false) ORDER BY created_date DESC`,
      [req.user.id]
    );
    return res.json(r.rows);
  } catch (err) {
    console.error('[suggestions GET]', err);
    res.status(500).json({ error: String(err) });
  }
});

// User: soft-delete own suggestion
app.delete('/suggestions/:id', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE suggestions SET is_deleted=true, deleted_date=now(), updated_date=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    logActivity(req.user.id, 'suggestion_deleted', { suggestion_id: req.params.id }, req);
    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Mistral AI OCR ────────────────────────────────────────────────────────────
// Proxies image OCR through the server so the API key stays server-side.
// Caches results by SHA-256 image hash for 7 days to avoid redundant API calls.
//
// POST /ocr/image
//   Body: { imageBase64: string, mimeType?: string, batchId?: string }
//   Response: { wines: [{name, vintage, size}], cached: boolean, requestId: string }
const OCR_MODEL   = 'mistral-ocr-latest';
const PARSE_MODEL = 'mistral-small-latest';
const OCR_CACHE_DAYS = 7;

// Approximate cost constants (USD) for logging reference only — not billed by us
// mistral-ocr-latest: ~$1/1000 pages; mistral-small: $0.20/MTok in, $0.60/MTok out
function estimateCostUsd({ ocrPages = 0, parseInputTokens = 0, parseOutputTokens = 0 }) {
  const ocrCost   = ocrPages * 0.001;
  const parseCost = (parseInputTokens / 1_000_000) * 0.20 + (parseOutputTokens / 1_000_000) * 0.60;
  return Math.round((ocrCost + parseCost) * 1_000_000) / 1_000_000; // round to 6dp
}

// Attempt to repair common LLM JSON mistakes (missing commas between objects, trailing commas, etc.)
function repairLlmJson(raw) {
  let s = raw.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Extract outermost {...}
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');
  s = s.slice(start, end + 1);
  // Missing comma between adjacent objects: }  { → },{
  s = s.replace(/\}\s*\{/g, '},{');
  // Missing comma between adjacent arrays/objects closing and next element: ] { or } [
  s = s.replace(/\]\s*\{/g, '],{');
  s = s.replace(/\}\s*\[/g, '},[');
  // Trailing commas before ] or }
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

// Last-resort: extract individual wine objects via regex even from broken JSON
function extractWinesFromBrokenJson(raw) {
  const wines = [];
  // Match individual {...} objects that look like wine entries
  const objRe = /\{[^{}]*"name"\s*:[^{}]*\}/g;
  let m;
  while ((m = objRe.exec(raw)) !== null) {
    try {
      const w = JSON.parse(repairLlmJson(m[0]));
      if (w.name?.trim()) wines.push(w);
    } catch { /* skip unparseable fragment */ }
  }
  return wines;
}

// Magic-byte signatures for allowed file types
const MAGIC_BYTES = [
  { mime: 'image/jpeg',    hex: 'ffd8ff' },
  { mime: 'image/png',     hex: '89504e47' },
  { mime: 'image/webp',    hex: '52494646' },  // RIFF....WEBP
  { mime: 'image/gif',     hex: '47494638' },
  { mime: 'image/tiff',    hex: '49492a00' },  // little-endian TIFF
  { mime: 'image/tiff',    hex: '4d4d002a' },  // big-endian TIFF
  { mime: 'application/pdf', hex: '25504446' }, // %PDF
];

function detectMimeFromBase64(b64) {
  try {
    const buf = Buffer.from(b64.slice(0, 16), 'base64');
    const hex = buf.toString('hex').toLowerCase();
    for (const { mime, hex: magic } of MAGIC_BYTES) {
      if (hex.startsWith(magic)) return mime;
    }
    // WEBP: check bytes 8-11 for 'WEBP'
    if (hex.slice(0, 8) === '52494646' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return null;
  } catch { return null; }
}

app.post('/ocr/image', authMiddleware, async (req, res) => {
  const { imageBase64 } = req.body || {};
  const userId = req.user.id;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 required' });
  }

  // Validate actual file content via magic bytes — ignore client-supplied mimeType
  const detectedMime = detectMimeFromBase64(imageBase64);
  if (!detectedMime) {
    return res.status(400).json({ error: 'Unsupported file type. Please upload a JPEG, PNG, WebP, GIF, TIFF, or PDF.' });
  }
  const isPdf = detectedMime === 'application/pdf';
  const mimeType = detectedMime;

  const MISTRAL_KEY = process.env.MISTRAL_API_KEY;
  if (!MISTRAL_KEY) {
    console.error('[ocr] MISTRAL_API_KEY not set');
    return res.status(503).json({ error: 'OCR service not configured' });
  }

  // SHA-256 of the raw base64 string — same file always yields same hash
  const imageHash = crypto.createHash('sha256').update(imageBase64).digest('hex');

  // ── Cache check ──────────────────────────────────────────────────────────────
  try {
    const cached = await pool.query(
      `SELECT id, wines_json FROM ocr_requests
       WHERE image_hash=$1 AND status='success' AND wines_json IS NOT NULL
         AND created_date > NOW() - INTERVAL '${OCR_CACHE_DAYS} days'
       ORDER BY created_date DESC LIMIT 1`,
      [imageHash]
    );

    if (cached.rowCount) {
      const wines = JSON.parse(cached.rows[0].wines_json);
      // Record the cache hit for cost attribution
      const logR = await pool.query(
        `INSERT INTO ocr_requests
           (user_id, ocr_model, parse_model, image_hash, cached, wines_detected, wines_json, status)
         VALUES ($1,$2,$3,$4,true,$5,$6,'success') RETURNING id`,
        [userId, OCR_MODEL, PARSE_MODEL, imageHash, wines.length, JSON.stringify(wines)]
      );
      console.log(`[ocr] cache hit hash=${imageHash.slice(0, 12)}… user=${userId}`);
      logActivity(userId, 'ocr_request', {
        request_id: logR.rows[0].id, cached: true, status: 'success',
        wines_detected: wines.length,
        ocr_pages: 0, parse_input_tokens: 0, parse_output_tokens: 0,
        estimated_cost_usd: 0,
      }, req);
      return res.json({ wines, cached: true, requestId: logR.rows[0].id });
    }
  } catch (cacheErr) {
    // Non-fatal — fall through to live API call
    console.warn('[ocr] cache check failed:', cacheErr.message);
  }

  // ── OCR credit limit check (skipped for admin) ───────────────────────────────
  // Credits are counted by summing ocr_pages (each PDF page = 1 credit, each image = 1 credit)
  try {
    const uR = await pool.query('SELECT subscription_plan, role_type, bonus_ocr_credits FROM users WHERE id=$1', [userId]);
    if (uR.rowCount && uR.rows[0].role_type !== 'admin') {
      const plan = normalizePlan(uR.rows[0].subscription_plan);
      const isFree = plan === 'free';
      const bonusOcr = parseInt(uR.rows[0].bonus_ocr_credits || 0, 10);
      // Free plan: count all-time OCR usage (credits are lifetime, not monthly)
      const [limitR, usedR] = await Promise.all([
        pool.query('SELECT monthly_ocr_limit FROM wine_subscriptions WHERE plan_name=$1', [plan]),
        pool.query(
          isFree
            ? `SELECT COUNT(*) AS used FROM ocr_requests WHERE user_id=$1 AND status='success'`
            : `SELECT COUNT(*) AS used FROM ocr_requests WHERE user_id=$1 AND status='success' AND created_date >= date_trunc('month', NOW())`,
          [userId]
        ),
      ]);
      const limit = parseInt(limitR.rows[0]?.monthly_ocr_limit ?? 2, 10) + bonusOcr;
      const used  = parseInt(usedR.rows[0].used, 10);
      if (used >= limit) {
        const errorMsg = isFree
          ? `AI Image Search credit limit reached (${used}/${limit} total). Please upgrade your plan.`
          : `Monthly AI Image Search limit reached (${used}/${limit}). Please upgrade your plan.`;
        return res.status(429).json({ error: errorMsg, used, limit, plan });
      }
    }
  } catch (limitErr) {
    console.warn('[ocr] limit check failed:', limitErr.message);
  }

  // ── Step 1: mistral-ocr-latest ───────────────────────────────────────────────
  let ocrPages = 0, ocrDocSize = 0, ocrText = '';
  try {
    const ocrRes = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({
        model: OCR_MODEL,
        document: isPdf
          ? { type: 'document_url', document_url: `data:application/pdf;base64,${imageBase64}` }
          : { type: 'image_url', image_url: `data:${mimeType};base64,${imageBase64}` },
        include_image_base64: false,
      }),
    });

    const ocrBody = await ocrRes.text();
    if (!ocrRes.ok) throw new Error(`OCR API ${ocrRes.status}: ${ocrBody.slice(0, 300)}`);

    const ocrData = JSON.parse(ocrBody);
    ocrPages   = ocrData.usage_info?.pages_processed || 1;
    ocrDocSize = ocrData.usage_info?.doc_size_bytes  || 0;
    ocrText    = (ocrData.pages || []).map(p => p.markdown).join('\n\n');
    console.log(`[ocr] OCR done pages=${ocrPages} bytes=${ocrDocSize} user=${userId}`);
  } catch (ocrErr) {
    console.error('[ocr] OCR step failed:', ocrErr.message);
    await pool.query(
      `INSERT INTO ocr_requests
         (user_id, ocr_model, parse_model, image_hash, status, error_message)
       VALUES ($1,$2,$3,$4,'error',$5)`,
      [userId, OCR_MODEL, PARSE_MODEL, imageHash, `OCR: ${ocrErr.message}`]
    ).catch(() => {});
    logActivity(userId, 'ocr_request', {
      cached: false, status: 'error', stage: 'ocr',
      error: ocrErr.message, ocr_pages: 0, parse_input_tokens: 0, parse_output_tokens: 0,
      estimated_cost_usd: 0,
    }, req);
    return res.status(502).json({ error: `OCR failed: ${ocrErr.message}` });
  }

  // ── Step 2: mistral-small-latest — structured wine extraction ────────────────
  let parseInputTokens = 0, parseOutputTokens = 0, wines = [];
  try {
    // Truncate very long OCR output to keep token usage bounded
    const ocrSnippet = ocrText.slice(0, 8000);

    const parseRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `From the following wine label or menu text, extract all wine entries.\n` +
            `Return a JSON object with a "wines" array. Each element must have:\n` +
            `- "name": producer and wine name only (no vintage year, no bottle size)\n` +
            `- "vintage": 4-digit year string (e.g. "2019"), or "" if not present\n` +
            `- "size": bottle size in standard format (e.g. "750ml", "1.5L", "3L", "375ml"), or null if not shown\n\n` +
            `Important rules:\n` +
            `- The "size" field is BOTTLE size only — NOT glass/pour size (e.g. "150ml glass" or "175ml pour" → set size to null)\n` +
            `- If the same wine appears multiple times (different sections, repeated rows), include it ONCE only\n` +
            `- Each unique wine should appear exactly once in the output array\n` +
            `- The vintage year may appear ANYWHERE on the label — capsule, neck sticker, body, back label. ` +
            `Search the entire text for any standalone 4-digit number between 1900 and ${new Date().getFullYear()} and treat it as the vintage.\n\n` +
            `Text:\n${ocrSnippet}\n\nReturn ONLY valid JSON.`,
        }],
        response_format: { type: 'json_object' },
      }),
    });

    const parseBody = await parseRes.text();
    if (!parseRes.ok) throw new Error(`Parse API ${parseRes.status}: ${parseBody.slice(0, 300)}`);

    const parseData = JSON.parse(parseBody);
    parseInputTokens  = parseData.usage?.prompt_tokens     || 0;
    parseOutputTokens = parseData.usage?.completion_tokens || 0;

    const rawContent = parseData.choices[0].message.content;
    let parsed;
    // Attempt 1: direct parse
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // Attempt 2: repair common LLM JSON issues (missing commas, trailing commas, fences)
      try {
        parsed = JSON.parse(repairLlmJson(rawContent));
        console.warn('[ocr] JSON repaired successfully');
      } catch {
        // Attempt 3: regex-extract individual wine objects from broken JSON
        const rescued = extractWinesFromBrokenJson(rawContent);
        if (rescued.length > 0) {
          console.warn(`[ocr] JSON rescue: extracted ${rescued.length} wines from broken output`);
          parsed = { wines: rescued };
        } else {
          throw new Error('Could not parse or repair JSON from parse response');
        }
      }
    }
    wines = (parsed.wines || []).filter(w => w.name?.trim());
    console.log(`[ocr] parse done wines=${wines.length} in=${parseInputTokens} out=${parseOutputTokens} user=${userId}`);
  } catch (parseErr) {
    console.error('[ocr] parse step failed:', parseErr.message);
    await pool.query(
      `INSERT INTO ocr_requests
         (user_id, ocr_model, parse_model, ocr_pages, ocr_doc_size_bytes, image_hash, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,'error',$7)`,
      [userId, OCR_MODEL, PARSE_MODEL, ocrPages, ocrDocSize, imageHash, `Parse: ${parseErr.message}`]
    ).catch(() => {});
    logActivity(userId, 'ocr_request', {
      cached: false, status: 'error', stage: 'parse',
      error: parseErr.message,
      ocr_pages: ocrPages, ocr_doc_size_bytes: ocrDocSize,
      parse_input_tokens: 0, parse_output_tokens: 0,
      estimated_cost_usd: estimateCostUsd({ ocrPages, parseInputTokens: 0, parseOutputTokens: 0 }),
    }, req);
    return res.status(502).json({ error: `Wine extraction failed: ${parseErr.message}` });
  }

  // ── Persist successful request ────────────────────────────────────────────────
  let requestId = null;
  try {
    const logR = await pool.query(
      `INSERT INTO ocr_requests
         (user_id, ocr_model, parse_model,
          ocr_pages, ocr_doc_size_bytes,
          parse_input_tokens, parse_output_tokens,
          wines_detected, wines_json, image_hash, cached, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'success') RETURNING id`,
      [
        userId, OCR_MODEL, PARSE_MODEL,
        ocrPages, ocrDocSize,
        parseInputTokens, parseOutputTokens,
        wines.length, JSON.stringify(wines), imageHash,
      ]
    );
    requestId = logR.rows[0].id;
    const cost = estimateCostUsd({ ocrPages, parseInputTokens, parseOutputTokens });
    console.log(`[ocr] logged id=${requestId} wines=${wines.length} est_cost=$${cost} user=${userId}`);
    logActivity(userId, 'ocr_request', {
      request_id: requestId, cached: false, status: 'success',
      wines_detected: wines.length,
      ocr_pages: ocrPages, ocr_doc_size_bytes: ocrDocSize,
      parse_input_tokens: parseInputTokens, parse_output_tokens: parseOutputTokens,
      estimated_cost_usd: cost,
    }, req);
  } catch (logErr) {
    console.warn('[ocr] failed to log request:', logErr.message);
  }

  return res.json({ wines, cached: false, requestId });
});

// ── Admin: OCR usage / cost dashboard ────────────────────────────────────────
// GET /admin/ocr/usage?range=7|30|90|365|all
app.get('/admin/ocr/usage', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const rangeMap = { '7': 7, '30': 30, '90': 90, '365': 365, all: null };
    const days = rangeMap[req.query.range] ?? 30;
    const since = days ? `NOW() - INTERVAL '${days} days'` : `'epoch'`;

    const [summary, byUser, byDay] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                         AS total_requests,
          COUNT(*) FILTER (WHERE cached = true)           AS cached_requests,
          COUNT(*) FILTER (WHERE status = 'error')        AS failed_requests,
          COALESCE(SUM(ocr_pages), 0)                     AS total_ocr_pages,
          COALESCE(SUM(parse_input_tokens), 0)            AS total_input_tokens,
          COALESCE(SUM(parse_output_tokens), 0)           AS total_output_tokens,
          COALESCE(SUM(wines_detected), 0)                AS total_wines_detected,
          COALESCE(SUM(
            ocr_pages * 0.001 +
            (parse_input_tokens  / 1000000.0) * 0.10 +
            (parse_output_tokens / 1000000.0) * 0.30
          ), 0)                                           AS estimated_cost_usd
        FROM ocr_requests
        WHERE created_date > ${since}
      `),
      pool.query(`
        SELECT
          u.email,
          COUNT(r.id)                                         AS requests,
          COUNT(r.id) FILTER (WHERE r.cached = true)         AS cached,
          COALESCE(SUM(r.wines_detected), 0)                 AS wines_detected,
          COALESCE(SUM(
            r.ocr_pages * 0.001 +
            (r.parse_input_tokens  / 1000000.0) * 0.10 +
            (r.parse_output_tokens / 1000000.0) * 0.30
          ), 0)                                              AS estimated_cost_usd
        FROM ocr_requests r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.created_date > ${since}
        GROUP BY u.email
        ORDER BY estimated_cost_usd DESC
        LIMIT 50
      `),
      pool.query(`
        SELECT
          date_trunc('day', created_date)::date AS day,
          COUNT(*)                               AS requests,
          COALESCE(SUM(wines_detected), 0)       AS wines_detected,
          COALESCE(SUM(
            ocr_pages * 0.001 +
            (parse_input_tokens  / 1000000.0) * 0.10 +
            (parse_output_tokens / 1000000.0) * 0.30
          ), 0)                                  AS estimated_cost_usd
        FROM ocr_requests
        WHERE created_date > ${since}
        GROUP BY day
        ORDER BY day DESC
      `),
    ]);

    res.json({
      summary: summary.rows[0],
      by_user: byUser.rows,
      by_day:  byDay.rows,
    });
  } catch (err) {
    console.error('[admin/ocr/usage]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── Admin: maintenance job dashboard ─────────────────────────────────────────
// GET /admin/maintenance — list all jobs with status, last run, next run, error
app.get('/admin/maintenance', authMiddleware, adminMiddleware, async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT job_name, interval_hours, last_run_at, next_run_at,
             running_since, last_status, last_error, rows_affected, run_count, created_at
      FROM maintenance_jobs
      ORDER BY job_name
    `);
    return res.json(r.rows);
  } catch (e) {
    console.error('[admin/maintenance GET]', e);
    res.status(500).json({ error: String(e) });
  }
});

// POST /admin/maintenance/run/:job — manually trigger a specific job immediately.
// Useful for ops: force-run a cleanup after a bulk data import, or re-run a job
// that errored without waiting for its next scheduled window.
app.post('/admin/maintenance/run/:job', authMiddleware, adminMiddleware, async (req, res) => {
  const { job } = req.params;
  if (!MAINTENANCE_JOB_REGISTRY[job]) {
    return res.status(404).json({ error: `Unknown job '${job}'. Valid jobs: ${Object.keys(MAINTENANCE_JOB_REGISTRY).join(', ')}` });
  }
  try {
    logActivity(req.user.id, 'admin_maintenance_triggered', { job_name: job }, req);
    const result = await runMaintenanceJob(job);
    return res.json({ success: result.success, job, rowCount: result.rowCount, error: result.error || null });
  } catch (e) {
    console.error('[admin/maintenance/run]', e);
    res.status(500).json({ error: String(e) });
  }
});

// ── DB migrations (idempotent, run on every startup) ─────────────────────────
(async () => {
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_renewal_date TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_reset_date TIMESTAMP`);
    // Unique constraint on transaction_id so ON CONFLICT (transaction_id) DO NOTHING works
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_payments_transaction_id_idx
      ON users_payments(transaction_id) WHERE transaction_id IS NOT NULL
    `);
    // Rename "CellarTracker integration" → "Cellar Tracker integration" in all plan features
    await pool.query(`
      UPDATE wine_subscriptions
      SET features = REPLACE(features::text, 'CellarTracker integration', 'Cellar Tracker integration')::jsonb
      WHERE features::text LIKE '%CellarTracker integration%'
    `);
    console.log('[DB] Subscription schema migrations applied');
  } catch (e) {
    console.error('[DB] Migration error (non-fatal):', e.message);
  }
})();

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: dbHost });
  } catch (e) {
    res.status(503).json({ status: 'error', db: dbHost, error: e.message });
  }
});

const httpServer = app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
httpServer.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process and restart.`);
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
