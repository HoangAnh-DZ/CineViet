-- PREPARED ONLY. Requires explicit approval before production execution or
-- changing Vercel DATABASE_URL. No existing role, owner, row or policy is changed.
-- NOLOGIN keeps the new role unusable by a remote client until approved setup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cinevjet_runtime') THEN
  RAISE EXCEPTION 'Runtime role already exists; review instead of overwriting permissions';
 END IF;
END $$;
CREATE ROLE cinevjet_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
DO $$ BEGIN
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO cinevjet_runtime', current_database());
END $$;
GRANT USAGE ON SCHEMA cinevjet TO cinevjet_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA cinevjet TO cinevjet_runtime;
GRANT USAGE ON SEQUENCE cinevjet.payos_order_code TO cinevjet_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cinevjet TO cinevjet_runtime;
GRANT INSERT (id,email,password_hash,display_name,referral_code,referred_by) ON cinevjet.users TO cinevjet_runtime;
GRANT UPDATE (display_name,status,updated_at,referral_code) ON cinevjet.users TO cinevjet_runtime;
GRANT INSERT (user_id) ON cinevjet.wallets,cinevjet.coin_wallets TO cinevjet_runtime;
GRANT UPDATE (balance,reserved) ON cinevjet.wallets,cinevjet.coin_wallets TO cinevjet_runtime;
GRANT INSERT,DELETE ON cinevjet.sessions,cinevjet.favorites,cinevjet.saved_shorts,cinevjet.movie_genres TO cinevjet_runtime;
GRANT INSERT ON cinevjet.coin_ledger,cinevjet.wallet_ledger,cinevjet.daily_checkins,cinevjet.daily_mission_claims,
 cinevjet.referral_commissions,cinevjet.reward_code_redemptions,cinevjet.deposit_bills,cinevjet.money_audit,
 cinevjet.payment_events,cinevjet.payout_audit,cinevjet.short_uploads,cinevjet.short_publications,
 cinevjet.genres,cinevjet.seasons TO cinevjet_runtime;
-- PostgreSQL requires UPDATE privilege on at least one column for FOR UPDATE.
-- The bill row lock serializes cross-table reuse checks; URL/content stay immutable.
GRANT UPDATE (id) ON cinevjet.deposit_bills TO cinevjet_runtime;
GRANT INSERT,UPDATE ON cinevjet.auth_limits,cinevjet.registration_challenges,cinevjet.movies,cinevjet.episodes,
 cinevjet.video_sources,cinevjet.vip_checkin_cycles,cinevjet.vip_purchase_requests,cinevjet.deposits,
 cinevjet.withdrawals,cinevjet.daily_watch_progress,cinevjet.reward_watch_sessions,cinevjet.reward_codes,
 cinevjet.payos_orders,cinevjet.withdrawal_jobs,cinevjet.short_videos,cinevjet.short_sources,
 cinevjet.short_sync_days,cinevjet.short_sync_runs,cinevjet.user_bank_accounts TO cinevjet_runtime;
GRANT INSERT,UPDATE,DELETE ON cinevjet.watch_history TO cinevjet_runtime;
GRANT INSERT ON cinevjet.vip_subscriptions TO cinevjet_runtime;
GRANT UPDATE (status) ON cinevjet.vip_subscriptions TO cinevjet_runtime;
GRANT UPDATE ON cinevjet.vip_plans,cinevjet.system_settings,cinevjet.payout_control,cinevjet.short_sync_control TO cinevjet_runtime;
-- Deliberately no writes to admin_users, no ledger/audit UPDATE/DELETE, no DDL,
-- no future-table default grants, no new RLS policy, no owner/role changes.
COMMIT;
