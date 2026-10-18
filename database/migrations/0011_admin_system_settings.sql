-- Additive operational settings; existing money, wallet and ledger rows are untouched.
CREATE TABLE IF NOT EXISTS cinevjet.system_settings (
  id text PRIMARY KEY CHECK (id='default'),
  deposit_enabled boolean NOT NULL DEFAULT true,
  withdrawal_enabled boolean NOT NULL DEFAULT true,
  bank_name text NOT NULL DEFAULT 'TPBank',
  account_number text NOT NULL DEFAULT '0000000000',
  account_name text NOT NULL DEFAULT 'EXAMPLE ACCOUNT',
  min_deposit bigint NOT NULL DEFAULT 50000 CHECK (min_deposit>0),
  min_withdrawal bigint NOT NULL DEFAULT 50000 CHECK (min_withdrawal>0),
  max_amount bigint NOT NULL DEFAULT 100000000 CHECK (max_amount>=min_withdrawal),
  withdrawal_fee bigint NOT NULL DEFAULT 3000 CHECK (withdrawal_fee>=0),
  updated_by text REFERENCES cinevjet.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cinevjet.system_settings(id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
