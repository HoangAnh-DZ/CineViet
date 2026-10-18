-- Extend existing cash requests; preserve all existing rows, balances and ledgers.
ALTER TABLE cinevjet.deposits DROP CONSTRAINT deposits_status_check;
ALTER TABLE cinevjet.deposits ADD CONSTRAINT deposits_status_check CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','REJECTED'));
CREATE TABLE cinevjet.deposit_bills (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id), url text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK(content_type='image/webp'), size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=3145728),
 width integer NOT NULL, height integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cinevjet.deposits
 ADD COLUMN bill_id text UNIQUE REFERENCES cinevjet.deposit_bills(id),
 ADD COLUMN bill_url text, ADD COLUMN bank_name text, ADD COLUMN bank_account_number text, ADD COLUMN bank_account_name text,
 ADD COLUMN user_note text, ADD COLUMN admin_note text, ADD COLUMN public_reason text, ADD COLUMN reviewed_by text REFERENCES cinevjet.users(id),
 ADD COLUMN completed_at timestamptz, ADD COLUMN rejected_at timestamptz, ADD COLUMN updated_at timestamptz;
ALTER TABLE cinevjet.withdrawals
 ADD COLUMN bank_name text, ADD COLUMN bank_account_number text, ADD COLUMN bank_account_name text,
 ADD COLUMN user_note text, ADD COLUMN admin_note text, ADD COLUMN public_reason text, ADD COLUMN reviewed_by text REFERENCES cinevjet.users(id),
 ADD COLUMN completed_at timestamptz, ADD COLUMN rejected_at timestamptz, ADD COLUMN updated_at timestamptz;
CREATE TABLE cinevjet.money_audit (
 id text PRIMARY KEY, admin_id text NOT NULL REFERENCES cinevjet.users(id), admin_email text NOT NULL,
 request_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('DEPOSIT','WITHDRAWAL')),
 action text NOT NULL CHECK(action IN ('DEPOSIT_APPROVED','DEPOSIT_REJECTED','WITHDRAWAL_COMPLETED','WITHDRAWAL_REJECTED')),
 note text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,request_id)
);
CREATE INDEX deposits_user_recent_idx ON cinevjet.deposits(user_id,created_at DESC);
CREATE INDEX withdrawals_user_recent_idx ON cinevjet.withdrawals(user_id,created_at DESC);
CREATE INDEX deposits_pending_idx ON cinevjet.deposits(created_at) WHERE status='PENDING';
CREATE INDEX withdrawals_pending_idx ON cinevjet.withdrawals(created_at) WHERE status='PENDING';
