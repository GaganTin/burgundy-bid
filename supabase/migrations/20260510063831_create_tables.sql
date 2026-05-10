-- ── Drop all existing tables (clean slate) ────────────────────────────────────
DROP TABLE IF EXISTS user_column_settings    CASCADE;
DROP TABLE IF EXISTS ticket_replies          CASCADE;
DROP TABLE IF EXISTS support_tickets         CASCADE;
DROP TABLE IF EXISTS suggestions             CASCADE;
DROP TABLE IF EXISTS contact_submissions     CASCADE;
DROP TABLE IF EXISTS system_alerts           CASCADE;
DROP TABLE IF EXISTS ocr_requests            CASCADE;
DROP TABLE IF EXISTS maintenance_jobs        CASCADE;
DROP TABLE IF EXISTS wine_subscriptions      CASCADE;
DROP TABLE IF EXISTS users_payments          CASCADE;
DROP TABLE IF EXISTS refresh_tokens          CASCADE;
DROP TABLE IF EXISTS users_sessions          CASCADE;
DROP TABLE IF EXISTS users_activity          CASCADE;
DROP TABLE IF EXISTS wine_lookups            CASCADE;
DROP TABLE IF EXISTS users_connections       CASCADE;
DROP TABLE IF EXISTS users                   CASCADE;
DROP TABLE IF EXISTS proxies                 CASCADE;

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date                TIMESTAMPTZ NOT NULL DEFAULT now(),
  full_name                   TEXT,
  email                       TEXT UNIQUE,
  password                    TEXT,
  role_type                   TEXT        NOT NULL DEFAULT 'user',
  phone                       TEXT,
  is_deleted                  BOOLEAN     NOT NULL DEFAULT false,
  deleted_date                TIMESTAMPTZ,
  preferred_theme             TEXT        DEFAULT 'light',
  subscription_plan           TEXT        DEFAULT 'free',
  subscription_price          NUMERIC(10, 2) DEFAULT 0,
  subscription_started        TIMESTAMPTZ,
  subscription_ended          TIMESTAMPTZ,
  stripe_customer_id          TEXT,
  password_reset_token        TEXT,
  password_reset_expires      TIMESTAMPTZ,
  is_email_verified           BOOLEAN     NOT NULL DEFAULT false,
  email_verification_code     TEXT,
  email_verification_expires  TIMESTAMPTZ,
  failed_login_attempts       INTEGER     NOT NULL DEFAULT 0,
  locked_until                TIMESTAMPTZ,
  last_login                  TIMESTAMPTZ,
  google_id                   TEXT UNIQUE,
  bonus_lookup_credits        INTEGER     NOT NULL DEFAULT 0,
  bonus_ocr_credits           INTEGER     NOT NULL DEFAULT 0,
  subscription_id             UUID        DEFAULT '59e54410-bedd-4429-8ad4-8982fafa99a2',
  credits_expiry_date         TIMESTAMPTZ
);

-- ── proxies ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proxies (
  id            TEXT        PRIMARY KEY,
  proxy_address TEXT        NOT NULL,
  http_port     INTEGER     NOT NULL,
  socks5_port   INTEGER,
  username      TEXT        NOT NULL,
  password_enc  TEXT        NOT NULL,
  country_code  TEXT,
  city_name     TEXT,
  valid         BOOLEAN     NOT NULL DEFAULT true,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── users_connections ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_connections (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        REFERENCES users(id) ON DELETE CASCADE,
  created_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date        TIMESTAMPTZ NOT NULL DEFAULT now(),
  site_name           TEXT        NOT NULL,
  email               TEXT        NOT NULL,
  password            TEXT,
  account_username    TEXT,
  status              TEXT        DEFAULT 'not connected',
  is_connected        BOOLEAN     DEFAULT false,
  is_enabled          BOOLEAN     DEFAULT true,
  is_error            BOOLEAN     DEFAULT false,
  error_message       TEXT,
  last_connected      TIMESTAMPTZ,
  proxy_id            TEXT        REFERENCES proxies(id),
  proxy_assigned_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS users_connections_user_id_idx  ON users_connections(user_id);
CREATE INDEX IF NOT EXISTS users_connections_proxy_id_idx ON users_connections(proxy_id) WHERE proxy_id IS NOT NULL;

-- ── wine_lookups ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wine_lookups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  wine_name    TEXT        NOT NULL,
  vintage      TEXT,
  size         TEXT        DEFAULT '750ml',
  ct_avg       TEXT,
  ct_auction   TEXT,
  ws_avg       TEXT,
  ws_min       TEXT,
  ct_url       TEXT,
  ws_url       TEXT,
  ws_currency  TEXT,
  ct_currency  TEXT        DEFAULT 'USD',
  offer_price  TEXT,
  offer_price_currency TEXT DEFAULT 'USD',
  matched_as   TEXT,
  ct_matched   TEXT,
  ws_matched   TEXT,
  ct_error     TEXT,
  ws_error     TEXT,
  batch_id     TEXT,
  status       TEXT        DEFAULT 'pending',
  lookup_source TEXT       DEFAULT 'server',
  lookup_type  TEXT,
  is_deleted   BOOLEAN     DEFAULT false,
  deleted_date TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS wine_lookups_batch_id_idx   ON wine_lookups(batch_id);
CREATE INDEX IF NOT EXISTS wine_lookups_user_id_idx    ON wine_lookups(user_id);
CREATE INDEX IF NOT EXISTS wine_lookups_user_month_idx ON wine_lookups(user_id, created_date) WHERE is_deleted = false;

-- ── users_activity ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_activity (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES users(id) ON DELETE CASCADE,
  connection_id    UUID        REFERENCES users_connections(id) ON DELETE SET NULL,
  activity_type    TEXT        NOT NULL,
  activity_details JSONB,
  ip_address       TEXT,
  user_agent       TEXT,
  created_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
  endpoint         TEXT,
  http_status      INTEGER,
  mode             TEXT,
  duration_ms      INTEGER
);

CREATE INDEX IF NOT EXISTS users_activity_user_id_date_idx ON users_activity(user_id, created_date DESC);
CREATE INDEX IF NOT EXISTS users_activity_type_idx         ON users_activity(activity_type);
CREATE INDEX IF NOT EXISTS users_activity_ip_address_idx   ON users_activity(ip_address);
CREATE INDEX IF NOT EXISTS users_activity_mode_idx         ON users_activity(mode) WHERE mode IS NOT NULL;

-- ── users_payments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_payments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(10, 2) NOT NULL,
  currency         TEXT        NOT NULL,
  payment_method   TEXT        NOT NULL,
  payment_status   TEXT        NOT NULL,
  transaction_id   TEXT,
  billing_interval TEXT,
  created_date     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── users_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,
  site            TEXT        NOT NULL,
  session_cookies TEXT,
  last_used       TIMESTAMPTZ,
  UNIQUE(user_id, site)
);

-- ── email_notifications ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT        NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference_date    TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS email_notifications_dedup
  ON email_notifications(user_id, notification_type, reference_date);

-- ── refresh_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx  ON refresh_tokens(expires_at);

-- ── wine_subscriptions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wine_subscriptions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name             VARCHAR(50)  UNIQUE NOT NULL,
  display_name          VARCHAR(100) NOT NULL,
  monthly_lookup_limit  INTEGER      NOT NULL,
  monthly_ocr_limit     INTEGER      DEFAULT 0,
  monthly_price_cents   INTEGER      NOT NULL DEFAULT 0,
  annual_price_cents    INTEGER      NOT NULL DEFAULT 0,
  stripe_price_id       TEXT,
  features              JSONB,
  created_at            TIMESTAMPTZ  DEFAULT NOW()
);

INSERT INTO wine_subscriptions
  (plan_name, display_name, monthly_lookup_limit, monthly_ocr_limit, monthly_price_cents, annual_price_cents, features)
VALUES
  ('free',           'Free',  20,    2,     0,     0,
   '["20 Lookup Credits","2 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration"]'),
  ('basic_monthly',  'Basic', 2000,  50,    600,   0,
   '["2,000 Lookup Credits per month","50 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration","6-month history retention","Premium support"]'),
  ('basic_annually', 'Basic', 2000,  50,    0,     6000,
   '["2,000 Lookup Credits per month","50 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration","6-month history retention","Premium support"]'),
  ('pro_monthly',    'Pro',   20000, 500,   900,   0,
   '["10x more credits than Basic","20,000 Lookup Credits per month","500 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration","6-month history retention","Priority support"]'),
  ('pro_annually',   'Pro',   20000, 500,   0,     9600,
   '["10x more credits than Basic","20,000 Lookup Credits per month","500 AI Image Credits","Cellar Tracker integration","Wine-Searcher integration","6-month history retention","Priority support"]'),
  ('admin',          'Admin', 99999, 99999, 0,     0,
   '["Unlimited admin access"]')
ON CONFLICT (plan_name) DO UPDATE
  SET monthly_lookup_limit = EXCLUDED.monthly_lookup_limit,
      monthly_ocr_limit    = EXCLUDED.monthly_ocr_limit,
      monthly_price_cents  = EXCLUDED.monthly_price_cents,
      annual_price_cents   = EXCLUDED.annual_price_cents,
      features             = EXCLUDED.features;

-- ── support_tickets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        REFERENCES users(id) ON DELETE CASCADE,
  created_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  title             TEXT        NOT NULL,
  category          TEXT        NOT NULL DEFAULT 'general',
  description       TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'open',
  priority          TEXT        NOT NULL DEFAULT 'normal',
  admin_reply       TEXT,
  admin_replied_at  TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  is_deleted        BOOLEAN     DEFAULT false,
  deleted_date      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx  ON support_tickets(status);

-- ── ticket_replies ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_replies (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type  TEXT        NOT NULL DEFAULT 'admin',
  author_name  TEXT,
  author_email TEXT,
  body         TEXT        NOT NULL,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_replies_ticket_id_idx ON ticket_replies(ticket_id);

-- ── suggestions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  title        TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'feature',
  description  TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'submitted',
  upvotes      INTEGER     NOT NULL DEFAULT 0,
  is_deleted   BOOLEAN     DEFAULT false,
  deleted_date TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS suggestions_user_id_idx ON suggestions(user_id);
CREATE INDEX IF NOT EXISTS suggestions_status_idx  ON suggestions(status);

-- ── contact_submissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_submissions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  subject      TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'new',
  is_deleted   BOOLEAN     DEFAULT false,
  deleted_date TIMESTAMPTZ
);

-- ── maintenance_jobs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_jobs (
  job_name       TEXT        PRIMARY KEY,
  interval_hours NUMERIC     NOT NULL,
  last_run_at    TIMESTAMPTZ,
  next_run_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  running_since  TIMESTAMPTZ,
  last_status    TEXT        NOT NULL DEFAULT 'pending',
  last_error     TEXT,
  rows_affected  INTEGER     NOT NULL DEFAULT 0,
  run_count      INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_jobs_next_run_idx ON maintenance_jobs(next_run_at);

INSERT INTO maintenance_jobs (job_name, interval_hours, next_run_at) VALUES
  ('soft_delete_old_lookups',       24,  now()),
  ('hard_delete_old_lookups',       24,  now()),
  ('purge_expired_refresh_tokens',  24,  now()),
  ('purge_old_ocr_requests',        168, now()),
  ('purge_orphaned_sessions',       24,  now()),
  ('purge_old_support_tickets',     168, now()),
  ('purge_old_suggestions',         168, now()),
  ('purge_old_contact_submissions', 168, now()),
  ('purge_old_activity_logs',       720, now())
ON CONFLICT (job_name) DO NOTHING;

-- ── ocr_requests ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ocr_requests (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        REFERENCES users(id) ON DELETE SET NULL,
  ocr_model            TEXT        NOT NULL DEFAULT 'mistral-ocr-latest',
  parse_model          TEXT        NOT NULL DEFAULT 'ministral-8b-latest',
  ocr_pages            INTEGER     DEFAULT 0,
  ocr_doc_size_bytes   INTEGER     DEFAULT 0,
  parse_input_tokens   INTEGER     DEFAULT 0,
  parse_output_tokens  INTEGER     DEFAULT 0,
  wines_detected       INTEGER     DEFAULT 0,
  wines_json           TEXT,
  image_hash           TEXT        NOT NULL,
  cached               BOOLEAN     DEFAULT false,
  status               TEXT        NOT NULL DEFAULT 'success',
  error_message        TEXT,
  created_date         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ocr_requests_user_id_idx      ON ocr_requests(user_id);
CREATE INDEX IF NOT EXISTS ocr_requests_image_hash_idx   ON ocr_requests(image_hash);
CREATE INDEX IF NOT EXISTS ocr_requests_created_date_idx ON ocr_requests(created_date);

-- ── system_alerts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_type   TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'warning',
  title        TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  details      JSONB,
  resolved     BOOLEAN     NOT NULL DEFAULT false,
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT
);

CREATE INDEX IF NOT EXISTS system_alerts_resolved_idx     ON system_alerts(resolved, created_date DESC);
CREATE INDEX IF NOT EXISTS system_alerts_alert_type_idx   ON system_alerts(alert_type);
CREATE INDEX IF NOT EXISTS system_alerts_created_date_idx ON system_alerts(created_date DESC);

-- ── user_column_settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_column_settings (
  user_id      UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calc_columns JSONB       NOT NULL DEFAULT '[]',
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now()
);
