-- Additive: cash and reward coins remain distinct; existing rows retain VND semantics.
ALTER TABLE cinevjet.coin_wallets ADD COLUMN reserved bigint NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND balance);
ALTER TABLE cinevjet.withdrawals
 ADD COLUMN source_asset text NOT NULL DEFAULT 'VND' CHECK(source_asset IN ('VND','COIN')),
 ADD COLUMN coins_amount bigint, ADD COLUMN coin_value_vnd bigint,
 ADD CONSTRAINT withdrawal_asset_contract CHECK((source_asset='VND' AND coins_amount IS NULL AND coin_value_vnd IS NULL) OR (source_asset='COIN' AND coins_amount IS NOT NULL AND coin_value_vnd IS NOT NULL AND coins_amount>0 AND coin_value_vnd>0 AND amount=coins_amount*coin_value_vnd));
ALTER TABLE cinevjet.withdrawals DROP CONSTRAINT withdrawals_status_check;
ALTER TABLE cinevjet.withdrawals ADD CONSTRAINT withdrawals_status_check CHECK(status IN ('PENDING','PROCESSING','COMPLETED','REJECTED','FAILED'));
CREATE TABLE cinevjet.vip_purchase_requests (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id), plan_id text NOT NULL REFERENCES cinevjet.vip_plans(id),
 plan_name text NOT NULL, amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 9007199254740991), duration_days integer NOT NULL CHECK(duration_days BETWEEN 1 AND 10000),
 reward_tier text NOT NULL CHECK(reward_tier IN ('VIP_BASIC','VIP_PLUS','VIP_PREMIUM')), reward_schedule integer[] NOT NULL CHECK(cinevjet.valid_reward_schedule(reward_schedule)),
 benefits_json jsonb NOT NULL,
 bill_id text NOT NULL UNIQUE REFERENCES cinevjet.deposit_bills(id),bill_url text NOT NULL,
 bank_name text NOT NULL,bank_account_number text NOT NULL,bank_account_name text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','REJECTED')),
 idempotency_key text NOT NULL UNIQUE,subscription_id text UNIQUE REFERENCES cinevjet.vip_subscriptions(id),
 user_note text,admin_note text,public_reason text,reviewed_by text REFERENCES cinevjet.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,rejected_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vip_purchase_user_recent_idx ON cinevjet.vip_purchase_requests(user_id,created_at DESC);
CREATE INDEX vip_purchase_pending_idx ON cinevjet.vip_purchase_requests(created_at) WHERE status='PENDING';
ALTER TABLE cinevjet.money_audit DROP CONSTRAINT money_audit_kind_check;
ALTER TABLE cinevjet.money_audit ADD CONSTRAINT money_audit_kind_check CHECK(kind IN ('DEPOSIT','WITHDRAWAL','VIP_PURCHASE'));
ALTER TABLE cinevjet.money_audit DROP CONSTRAINT money_audit_action_check;
ALTER TABLE cinevjet.money_audit ADD CONSTRAINT money_audit_action_check CHECK(action IN ('DEPOSIT_APPROVED','DEPOSIT_REJECTED','WITHDRAWAL_COMPLETED','WITHDRAWAL_REJECTED','REDEMPTION_COMPLETED','REDEMPTION_REJECTED','REDEMPTION_FAILED','VIP_APPROVED','VIP_REJECTED'));
