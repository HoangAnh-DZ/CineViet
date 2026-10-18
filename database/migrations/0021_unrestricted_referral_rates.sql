-- Requires separate Production approval. No balances, existing policies, snapshots,
-- commissions or classifications are modified. Keep obsolete control columns for rollback.
ALTER TABLE cinevjet.referral_policy_versions
 DROP CONSTRAINT referral_policy_versions_level1_bps_check,
 DROP CONSTRAINT referral_policy_versions_level2_bps_check,
 DROP CONSTRAINT referral_policy_versions_level3_bps_check,
 DROP CONSTRAINT referral_policy_versions_check,
 ADD CONSTRAINT referral_rates_nonnegative CHECK(level1_bps>=0 AND level2_bps>=0 AND level3_bps>=0);
ALTER TABLE cinevjet.referral_commission_entries
 DROP CONSTRAINT referral_commission_entries_bps_check,
 DROP CONSTRAINT referral_commission_entries_check,
 ADD CONSTRAINT referral_entry_bps_positive CHECK(bps>0),
 ADD CONSTRAINT referral_entry_amount_positive CHECK(amount>0);
CREATE OR REPLACE FUNCTION cinevjet.capture_referral_snapshot() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,cinevjet AS $$
DECLARE p record; parent_id text; current_id text; seen text[]; beneficiaries text[] := '{}'; reward numeric; rate integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.referral_snapshot IS DISTINCT FROM OLD.referral_snapshot THEN RAISE EXCEPTION 'Referral snapshot is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF current_setting('cinevjet.referral_v2',true) IS DISTINCT FROM 'on' THEN NEW.referral_snapshot:=NULL; RETURN NEW; END IF;
 SELECT v.* INTO STRICT p FROM cinevjet.referral_policy_control c
 JOIN cinevjet.referral_policy_versions v ON v.id=c.active_version WHERE c.id='default' FOR SHARE OF c;
 -- Refuse unrepresentable obligations before an order/payment link can be created.
 FOREACH rate IN ARRAY ARRAY[p.level1_bps,p.level2_bps,p.level3_bps] LOOP
  reward:=floor(NEW.amount::numeric*rate::numeric/10000);
  IF reward>9007199254740991 THEN RAISE EXCEPTION 'Referral amount exceeds integer precision'; END IF;
 END LOOP;
 current_id:=NEW.user_id; seen:=ARRAY[NEW.user_id];
 FOR depth IN 1..3 LOOP
  SELECT referred_by INTO parent_id FROM cinevjet.users WHERE id=current_id;
  EXIT WHEN parent_id IS NULL;
  IF parent_id=ANY(seen) THEN RAISE EXCEPTION 'Invalid referral relationship'; END IF;
  beneficiaries:=array_append(beneficiaries,parent_id); seen:=array_append(seen,parent_id); current_id:=parent_id;
 END LOOP;
 SELECT referred_by INTO parent_id FROM cinevjet.users WHERE id=current_id;
 IF parent_id=ANY(seen) THEN RAISE EXCEPTION 'Invalid referral relationship'; END IF;
 NEW.referral_snapshot:=jsonb_build_object('format',2,'version',p.id,'rates_bps',jsonb_build_array(p.level1_bps,p.level2_bps,p.level3_bps),'beneficiaries',to_jsonb(beneficiaries));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION cinevjet.capture_referral_snapshot() FROM PUBLIC;
