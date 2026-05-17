-- Add the unique constraint required by the ON CONFLICT (transaction_id) clause in
-- the payment record insert. Without this the deduplication guard fails silently.

ALTER TABLE users_payments ADD CONSTRAINT users_payments_transaction_id_key UNIQUE (transaction_id);
