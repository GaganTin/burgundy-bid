-- subscription_id was defined as UUID but Stripe subscription IDs (sub_xxx) are
-- plain strings. Change the column to TEXT so the server can cache them without error.

ALTER TABLE users ALTER COLUMN subscription_id TYPE TEXT USING subscription_id::TEXT;
