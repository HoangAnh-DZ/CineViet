-- Additive only: existing withdrawals, wallets and ledgers are untouched.
CREATE TABLE cinevjet.user_bank_accounts (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES cinevjet.users(id),
 bank_code text NOT NULL CHECK(bank_code ~ '^[0-9]{6}$'),
 bank_name text NOT NULL,
 bank_label text NOT NULL,
 details_ciphertext text NOT NULL,
 account_last4 text NOT NULL CHECK(account_last4 ~ '^[0-9]{4}$'),
 fingerprint text NOT NULL,
 nickname text NOT NULL DEFAULT '' CHECK(length(nickname)<=60),
 is_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CHECK(deleted_at IS NULL OR NOT is_default)
);
CREATE UNIQUE INDEX user_bank_account_default_idx ON cinevjet.user_bank_accounts(user_id) WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX user_bank_account_duplicate_idx ON cinevjet.user_bank_accounts(user_id,fingerprint) WHERE deleted_at IS NULL;
CREATE INDEX user_bank_account_list_idx ON cinevjet.user_bank_accounts(user_id,created_at,id) WHERE deleted_at IS NULL;
ALTER TABLE cinevjet.withdrawals
 ADD COLUMN bank_account_id text REFERENCES cinevjet.user_bank_accounts(id),
 ADD COLUMN bank_snapshot_ciphertext text,
 ADD CONSTRAINT withdrawal_saved_bank_snapshot CHECK ((bank_account_id IS NULL) = (bank_snapshot_ciphertext IS NULL));
