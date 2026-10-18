-- Additive only. Registration, referral and reward-code records are isolated from
-- existing balances; no existing financial rows are rewritten.
ALTER TABLE cinevjet.users
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by text REFERENCES cinevjet.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_idx
  ON cinevjet.users(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_referred_by_idx ON cinevjet.users(referred_by);

CREATE TABLE IF NOT EXISTS cinevjet.registration_challenges (
  id text PRIMARY KEY,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registration_challenges_expiry_idx
  ON cinevjet.registration_challenges(expires_at) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS cinevjet.referral_commissions (
  id text PRIMARY KEY,
  referrer_id text NOT NULL REFERENCES cinevjet.users(id),
  referred_user_id text NOT NULL REFERENCES cinevjet.users(id),
  source_id text NOT NULL REFERENCES cinevjet.vip_purchase_requests(id),
  percent integer NOT NULL CHECK(percent BETWEEN 1 AND 10),
  amount bigint NOT NULL CHECK(amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referred_user_id),
  UNIQUE(source_id)
);
CREATE INDEX IF NOT EXISTS referral_commissions_referrer_idx
  ON cinevjet.referral_commissions(referrer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS cinevjet.reward_codes (
  id text PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  code_last4 text NOT NULL,
  reward_coins integer NOT NULL CHECK(reward_coins BETWEEN 1 AND 1000000),
  max_redemptions integer NOT NULL CHECK(max_redemptions BETWEEN 1 AND 10000000),
  redeemed_count integer NOT NULL DEFAULT 0 CHECK(redeemed_count BETWEEN 0 AND max_redemptions),
  expires_at timestamptz,
  created_by text NOT NULL REFERENCES cinevjet.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_codes_created_idx ON cinevjet.reward_codes(created_at DESC);
CREATE TABLE IF NOT EXISTS cinevjet.reward_code_redemptions (
  id text PRIMARY KEY,
  code_id text NOT NULL REFERENCES cinevjet.reward_codes(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
  reward_coins integer NOT NULL CHECK(reward_coins > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code_id,user_id)
);
CREATE INDEX IF NOT EXISTS reward_code_redemptions_user_idx
  ON cinevjet.reward_code_redemptions(user_id,created_at DESC);
