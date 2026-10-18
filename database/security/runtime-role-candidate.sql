-- CANDIDATE ONLY: NOT APPLIED TO PRODUCTION. Requires separate approval.
-- Function PUBLIC revocations also affect other roles; review that impact.
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
REVOKE EXECUTE ON FUNCTION cinevjet.capture_vip_purchase_contract(),cinevjet.capture_vip_subscription_contract(),cinevjet.guard_referral_parent(),cinevjet.reward_now(),cinevjet.valid_reward_schedule(integer[]),cinevjet.vip_plan_contract(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cinevjet.reward_now(),cinevjet.valid_reward_schedule(integer[]),cinevjet.vip_plan_contract(text) TO cinevjet_runtime;
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
GRANT INSERT ON cinevjet.auth_limits,cinevjet.registration_challenges,cinevjet.movies,cinevjet.episodes,
 cinevjet.video_sources,cinevjet.vip_checkin_cycles,cinevjet.vip_purchase_requests,cinevjet.deposits,
 cinevjet.withdrawals,cinevjet.daily_watch_progress,cinevjet.reward_watch_sessions,cinevjet.reward_codes,
 cinevjet.payos_orders,cinevjet.withdrawal_jobs,cinevjet.short_videos,cinevjet.short_sources,
 cinevjet.short_sync_days,cinevjet.short_sync_runs,cinevjet.user_bank_accounts TO cinevjet_runtime;
GRANT UPDATE (attempts,window_start) ON cinevjet.auth_limits TO cinevjet_runtime;
GRANT UPDATE (attempts,used_at) ON cinevjet.registration_challenges TO cinevjet_runtime;
GRANT UPDATE (attribution,backdrop_url,country,description,duration_minutes,duration_seconds,is_demo,language,license_name,license_source_url,license_url,original_title,poster_attribution,poster_url,rating,release_year,slug,source_page_url,status,title,type,updated_at,vip_required) ON cinevjet.movies TO cinevjet_runtime;
GRANT UPDATE (description,duration_seconds,episode_number,release_date,season_number,status,thumbnail_url,title) ON cinevjet.episodes TO cinevjet_runtime;
GRANT UPDATE (is_active) ON cinevjet.video_sources TO cinevjet_runtime;
GRANT UPDATE (completed_at,current_day,status) ON cinevjet.vip_checkin_cycles TO cinevjet_runtime;
GRANT UPDATE (admin_note,bank_evidence_reference,completed_at,public_reason,rejected_at,reviewed_by,status,subscription_id,updated_at) ON cinevjet.vip_purchase_requests TO cinevjet_runtime;
GRANT UPDATE (admin_note,bank_account_name,bank_account_number,bank_name,completed_at,public_reason,rejected_at,reviewed_by,status,updated_at) ON cinevjet.deposits TO cinevjet_runtime;
GRANT UPDATE (admin_note,completed_at,public_reason,rejected_at,reviewed_by,status,updated_at) ON cinevjet.withdrawals TO cinevjet_runtime;
GRANT UPDATE (watched_ms) ON cinevjet.daily_watch_progress TO cinevjet_runtime;
GRANT UPDATE (id,last_at,nonce,playing,position_seconds,previous_nonce,request_hash,source_id) ON cinevjet.reward_watch_sessions TO cinevjet_runtime;
GRANT UPDATE (redeemed_count) ON cinevjet.reward_codes TO cinevjet_runtime;
GRANT UPDATE (account_name,account_number,bank_code,checked_at,checkout_url,payment_link_id,qr_code,settled_at,status,updated_at) ON cinevjet.payos_orders TO cinevjet_runtime;
GRANT UPDATE (attempts,completed_at,evidence_reference,evidence_url,last_error_code,lease_token,leased_until,next_attempt_at,provider_id,status,updated_at) ON cinevjet.withdrawal_jobs TO cinevjet_runtime;
GRANT UPDATE (creator_name,creator_url,deleted_at,description,display_order,duration_seconds,embed_confirmed_at,embed_status,episode_id,hashtags,is_active,last_checked_at,last_error,movie_id,next_check_at,permission_evidence,permission_status,publish_status,published_at,reviewed_by,source_credit,source_type,thumbnail_url,title,updated_at,video_url) ON cinevjet.short_videos TO cinevjet_runtime;
GRANT UPDATE (authorization_status,creator_name,last_error,last_synced_at,permission_evidence,reviewed_by,sync_enabled,updated_at) ON cinevjet.short_sources TO cinevjet_runtime;
GRANT UPDATE (videos_added) ON cinevjet.short_sync_days TO cinevjet_runtime;
GRANT UPDATE (candidates_checked,error_summary,finished_at,status,videos_added,videos_skipped) ON cinevjet.short_sync_runs TO cinevjet_runtime;
GRANT UPDATE (deleted_at,is_default,updated_at) ON cinevjet.user_bank_accounts TO cinevjet_runtime;
GRANT INSERT,DELETE ON cinevjet.watch_history TO cinevjet_runtime;
GRANT UPDATE (completed,duration_seconds,position_seconds,updated_at) ON cinevjet.watch_history TO cinevjet_runtime;
GRANT INSERT ON cinevjet.vip_subscriptions TO cinevjet_runtime;
GRANT UPDATE (status) ON cinevjet.vip_subscriptions TO cinevjet_runtime;
GRANT UPDATE (active,additional_amount,duration_days,mission_count,mission_reward,name,price,purchase_enabled) ON cinevjet.vip_plans TO cinevjet_runtime;
GRANT UPDATE (account_name,account_number,bank_name,deposit_enabled,max_amount,min_deposit,min_withdrawal,updated_at,updated_by,withdrawal_enabled,withdrawal_fee) ON cinevjet.system_settings TO cinevjet_runtime;
GRANT UPDATE (daily_limit,interval_seconds,lease_token,leased_until,next_dispatch_at,paused,transaction_limit,updated_at) ON cinevjet.payout_control TO cinevjet_runtime;
GRANT UPDATE (daily_target,enabled,lease_token,leased_until) ON cinevjet.short_sync_control TO cinevjet_runtime;
-- Deliberately no writes to admin_users, no ledger/audit UPDATE/DELETE, no DDL,
-- no future-table default grants, no new RLS policy, no owner/role changes.
COMMIT;

-- Existing functions lose PUBLIC EXECUTE only in this proposal.
-- Future functions still need an owner default-ACL review and explicit grants
-- in migrations; no owner default privileges are changed by this candidate.
