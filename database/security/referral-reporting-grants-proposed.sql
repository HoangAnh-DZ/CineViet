-- PROPOSED ONLY. Apply only after separate Production approval and migration 0020.
-- No default privileges, role membership, sequences, SECURITY DEFINER or owner changes.
BEGIN;
SET LOCAL lock_timeout='5s';
GRANT SELECT ON cinevjet.referral_policy_versions,cinevjet.referral_policy_control,
 cinevjet.referral_commission_entries,cinevjet.reporting_classifications TO cinevjet_runtime;
GRANT INSERT ON cinevjet.referral_policy_versions,cinevjet.referral_commission_entries,
 cinevjet.reporting_classifications TO cinevjet_runtime;
GRANT UPDATE(active_version) ON cinevjet.referral_policy_control TO cinevjet_runtime;
-- No UPDATE/DELETE on history/commissions/classifications, no economic-approval writes.
-- Trigger execution needs no direct EXECUTE grant and runs with caller table permissions.
COMMIT;
