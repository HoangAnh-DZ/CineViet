-- Additive only. Requires separate Production schema and runtime-grant approval.
-- No historical commissions, balances, payment statuses or classifications are changed.
CREATE TABLE cinevjet.referral_policy_versions (
 id text PRIMARY KEY,
 previous_id text REFERENCES cinevjet.referral_policy_versions(id),
 level1_bps integer NOT NULL CHECK(level1_bps BETWEEN 0 AND 10000),
 level2_bps integer NOT NULL CHECK(level2_bps BETWEEN 0 AND 10000),
 level3_bps integer NOT NULL CHECK(level3_bps BETWEEN 0 AND 10000),
 created_by text REFERENCES cinevjet.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL,
 CHECK(level1_bps+level2_bps+level3_bps<=10000)
);
INSERT INTO cinevjet.referral_policy_versions(id,level1_bps,level2_bps,level3_bps,reason)
 VALUES('legacy-10-percent',1000,0,0,'Immutable pre-migration orders only; preserves historical first-purchase policy');
INSERT INTO cinevjet.referral_policy_versions(id,level1_bps,level2_bps,level3_bps,reason)
 VALUES('f1-f2-f3-initial',1000,200,100,'Approved default F1 10%, F2 2%, F3 1%; new orders only');
CREATE TABLE cinevjet.referral_policy_control (
 id text PRIMARY KEY CHECK(id='default'),
 active_version text NOT NULL REFERENCES cinevjet.referral_policy_versions(id),
 approved_total_bps integer NOT NULL CHECK(approved_total_bps BETWEEN 0 AND 10000),
 multilevel_approved boolean NOT NULL DEFAULT false
);
-- Approved default maximum 13%. Increasing the budget requires separate review.
INSERT INTO cinevjet.referral_policy_control VALUES('default','f1-f2-f3-initial',1300,true);
ALTER TABLE cinevjet.vip_purchase_requests ADD COLUMN referral_snapshot jsonb;
CREATE FUNCTION cinevjet.capture_referral_snapshot() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,cinevjet AS $$
DECLARE p record; parent_id text; current_id text; seen text[]; beneficiaries text[] := '{}';
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.referral_snapshot IS DISTINCT FROM OLD.referral_snapshot THEN
   RAISE EXCEPTION 'Referral snapshot is immutable';
  END IF;
  RETURN NEW;
 END IF;
 -- Older application instances continue to create legacy orders during staged rollout.
 IF current_setting('cinevjet.referral_v2',true) IS DISTINCT FROM 'on' THEN
  NEW.referral_snapshot := NULL; RETURN NEW;
 END IF;
 SELECT v.*,c.approved_total_bps,c.multilevel_approved INTO STRICT p
 FROM cinevjet.referral_policy_control c JOIN cinevjet.referral_policy_versions v ON v.id=c.active_version
 WHERE c.id='default' FOR SHARE OF c;
 IF p.level1_bps+p.level2_bps+p.level3_bps>p.approved_total_bps OR
    (NOT p.multilevel_approved AND (p.level2_bps>0 OR p.level3_bps>0)) THEN
  RAISE EXCEPTION 'Referral policy requires economic approval';
 END IF;
 current_id := NEW.user_id; seen := ARRAY[NEW.user_id];
 FOR depth IN 1..3 LOOP
  SELECT referred_by INTO parent_id FROM cinevjet.users WHERE id=current_id;
  EXIT WHEN parent_id IS NULL;
  IF parent_id=ANY(seen) THEN RAISE EXCEPTION 'Invalid referral relationship'; END IF;
  beneficiaries := array_append(beneficiaries,parent_id);
  seen := array_append(seen,parent_id); current_id := parent_id;
 END LOOP;
 -- Detect a cycle closing immediately after the third ancestor too.
 SELECT referred_by INTO parent_id FROM cinevjet.users WHERE id=current_id;
 IF parent_id=ANY(seen) THEN RAISE EXCEPTION 'Invalid referral relationship'; END IF;
 NEW.referral_snapshot := jsonb_build_object('version',p.id,'rates_bps',jsonb_build_array(p.level1_bps,p.level2_bps,p.level3_bps),'cap_bps',p.approved_total_bps,'beneficiaries',to_jsonb(beneficiaries));
 RETURN NEW;
END $$;
CREATE TRIGGER capture_referral_snapshot BEFORE INSERT OR UPDATE OF referral_snapshot
 ON cinevjet.vip_purchase_requests FOR EACH ROW EXECUTE FUNCTION cinevjet.capture_referral_snapshot();
REVOKE ALL ON FUNCTION cinevjet.capture_referral_snapshot() FROM PUBLIC;

-- Legacy table/UNIQUE(referred_user_id) is deliberately retained unchanged.
CREATE TABLE cinevjet.referral_commission_entries (
 id text PRIMARY KEY,
 source_id text NOT NULL REFERENCES cinevjet.vip_purchase_requests(id),
 buyer_id text NOT NULL REFERENCES cinevjet.users(id),
 beneficiary_id text NOT NULL REFERENCES cinevjet.users(id),
 level integer NOT NULL CHECK(level BETWEEN 1 AND 3),
 bps integer NOT NULL CHECK(bps BETWEEN 1 AND 10000),
 purchase_amount bigint NOT NULL CHECK(purchase_amount>0),
 amount bigint NOT NULL CHECK(amount>0 AND amount<=purchase_amount),
 policy_id text NOT NULL REFERENCES cinevjet.referral_policy_versions(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(buyer_id<>beneficiary_id),
 CHECK(amount=floor(purchase_amount::numeric*bps/10000)),
 UNIQUE(source_id,level), UNIQUE(source_id,beneficiary_id)
);
CREATE INDEX referral_entries_beneficiary ON cinevjet.referral_commission_entries(beneficiary_id,created_at);

-- Append-only reporting decisions. No automatic exclusions or financial backfill.
CREATE TABLE cinevjet.reporting_classifications (
 id text PRIMARY KEY,
 target_kind text NOT NULL CHECK(target_kind IN ('DEPOSIT','VIP_PURCHASE','WITHDRAWAL')),
 target_id text NOT NULL,
 excluded boolean NOT NULL,
 previous_id text REFERENCES cinevjet.reporting_classifications(id),
 fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 confirmed_by text NOT NULL REFERENCES cinevjet.users(id),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reporting_classification_latest ON cinevjet.reporting_classifications(target_kind,target_id,confirmed_at DESC,id DESC);
