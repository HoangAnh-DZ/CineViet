-- Additive account-security state only; does not change existing users or sessions.
CREATE TABLE cinevjet.account_security_audit (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES cinevjet.users(id),
 action text NOT NULL CHECK(action IN ('DISPLAY_NAME_CHANGED','PASSWORD_CHANGED','EMAIL_CHANGE_REQUESTED','EMAIL_CHANGED')),
 detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_security_audit_user ON cinevjet.account_security_audit(user_id,created_at);
CREATE TABLE cinevjet.email_change_requests (
 id text PRIMARY KEY,user_id text NOT NULL REFERENCES cinevjet.users(id),
 new_email text NOT NULL,token_hash text NOT NULL UNIQUE,credential_hash text NOT NULL,
 expires_at timestamptz NOT NULL,used_at timestamptz,sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX email_change_requests_user ON cinevjet.email_change_requests(user_id,created_at);
