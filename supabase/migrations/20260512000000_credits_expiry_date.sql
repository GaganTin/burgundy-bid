-- Add credits_expiry_date column to track when free-plan or cancelled-plan credits expire.
--
-- Free plan: expires 1 month after account creation.
-- Active paid plan: NULL (credits reset monthly, no expiry).
-- Cancelled paid plan: set to NOW() when customer.subscription.deleted fires (= 0 credits).

ALTER TABLE users ADD COLUMN IF NOT EXISTS credits_expiry_date TIMESTAMPTZ;

-- Back-fill existing free-plan users: expiry = created_date + 1 month.
-- If that date has already passed, they will see 0 credits (by design — new policy).
UPDATE users
SET credits_expiry_date = created_date + INTERVAL '1 month'
WHERE (subscription_plan = 'free' OR subscription_plan IS NULL)
  AND credits_expiry_date IS NULL
  AND is_deleted = false;
