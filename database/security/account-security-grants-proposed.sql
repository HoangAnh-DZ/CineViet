-- Requires separate Production GRANT approval. No membership or owner changes.
BEGIN;
GRANT SELECT,INSERT ON cinevjet.account_security_audit,cinevjet.email_change_requests TO cinevjet_runtime;
GRANT UPDATE(used_at,sent_at) ON cinevjet.email_change_requests TO cinevjet_runtime;
GRANT UPDATE(email,password_hash) ON cinevjet.users TO cinevjet_runtime;
-- Audit history stays append-only; no Admin, financial or referral-parent writes.
COMMIT;
