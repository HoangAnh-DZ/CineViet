-- Backward compatible: no balance/history updates; manual VIP rows keep their bill contract.
ALTER TABLE cinevjet.vip_purchase_requests
 ADD COLUMN provider text NOT NULL DEFAULT 'MANUAL_BANK',
 ALTER COLUMN bill_id DROP NOT NULL, ALTER COLUMN bill_url DROP NOT NULL,
 ADD CONSTRAINT vip_payment_source CHECK(provider IN ('MANUAL_BANK','PAYOS') AND (provider='PAYOS' OR (bill_id IS NOT NULL AND bill_url IS NOT NULL)));
CREATE SEQUENCE cinevjet.payos_order_code START 1000000000000 MAXVALUE 9007199254740991 NO CYCLE;
CREATE TABLE cinevjet.payos_orders (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id),
 kind text NOT NULL CHECK(kind IN ('DEPOSIT','VIP_PURCHASE')),
 deposit_id text UNIQUE REFERENCES cinevjet.deposits(id), vip_purchase_id text UNIQUE REFERENCES cinevjet.vip_purchase_requests(id),
 order_code bigint NOT NULL UNIQUE DEFAULT nextval('cinevjet.payos_order_code'),
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 100000000), plan_id text REFERENCES cinevjet.vip_plans(id),
 idempotency_key text NOT NULL UNIQUE, payment_link_id text UNIQUE,
 status text NOT NULL DEFAULT 'CREATING' CHECK(status IN ('CREATING','PENDING','UNDERPAID','PROCESSING','PAID','CANCELLED','EXPIRED','FAILED')),
 checkout_url text, qr_code text, account_number text, account_name text, bank_code text,
 return_url text NOT NULL, cancel_url text NOT NULL, expires_at timestamptz NOT NULL,
 checked_at timestamptz, settled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='DEPOSIT' AND deposit_id IS NOT NULL AND vip_purchase_id IS NULL AND plan_id IS NULL) OR (kind='VIP_PURCHASE' AND vip_purchase_id IS NOT NULL AND deposit_id IS NULL AND plan_id IS NOT NULL))
);
CREATE INDEX payos_pending_idx ON cinevjet.payos_orders(checked_at,created_at) WHERE settled_at IS NULL;
CREATE TABLE cinevjet.payment_events (
 id text PRIMARY KEY, order_id text NOT NULL REFERENCES cinevjet.payos_orders(id),
 source text NOT NULL CHECK(source IN ('WEBHOOK','RECONCILIATION','CREATE')),
 event_key text NOT NULL UNIQUE, state text NOT NULL, provider_reference text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cinevjet.payout_control (
 id text PRIMARY KEY CHECK(id='default'), paused boolean NOT NULL DEFAULT false,
 interval_seconds integer NOT NULL DEFAULT 30 CHECK(interval_seconds BETWEEN 30 AND 86400),
 daily_limit bigint CHECK(daily_limit>0), transaction_limit bigint CHECK(transaction_limit>0),
 lease_token text, leased_until timestamptz, next_dispatch_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cinevjet.payout_control(id) VALUES('default');
CREATE TABLE cinevjet.withdrawal_jobs (
 withdrawal_id text PRIMARY KEY REFERENCES cinevjet.withdrawals(id),
 status text NOT NULL DEFAULT 'MANUAL_REVIEW' CHECK(status IN ('QUEUED','PROCESSING','SUBMITTED','RETRY_WAIT','NEEDS_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED','MANUAL_REVIEW')),
 bank_code text, reference_id text NOT NULL UNIQUE, idempotency_key text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token text, leased_until timestamptz, provider_id text UNIQUE, last_error_code text,
 evidence_reference text UNIQUE, evidence_url text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX withdrawal_queue_idx ON cinevjet.withdrawal_jobs(created_at,withdrawal_id) WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED');
CREATE TABLE cinevjet.payout_audit (
 id text PRIMARY KEY, withdrawal_id text REFERENCES cinevjet.withdrawal_jobs(withdrawal_id),
 actor_id text REFERENCES cinevjet.users(id), action text NOT NULL, amount bigint, note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
