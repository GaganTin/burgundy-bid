-- Tracks which notification emails have been sent per user per expiry cycle.
-- reference_date = the credits_expiry_date the reminder belongs to, so if a user
-- re-subscribes and cancels again they receive a fresh set of reminders.

CREATE TABLE IF NOT EXISTS email_notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT        NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reference_date    TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS email_notifications_dedup
  ON email_notifications(user_id, notification_type, reference_date);
