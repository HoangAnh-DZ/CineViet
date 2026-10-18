-- Additive preparation. Freeze existing contracts BEFORE changing the sale catalog.
-- No balance, ledger, payment status, subscription date or progress is changed.
ALTER TABLE cinevjet.vip_purchase_requests
 ADD COLUMN IF NOT EXISTS plan_snapshot jsonb,
 ADD COLUMN IF NOT EXISTS payment_reference text,
 ADD COLUMN IF NOT EXISTS bank_evidence_reference text;
ALTER TABLE cinevjet.vip_subscriptions ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;

CREATE OR REPLACE FUNCTION cinevjet.vip_plan_contract(plan text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('name',name,'price',price,'duration_days',duration_days,
  'mission_count',mission_count,'mission_reward',mission_reward,'reward_tier',reward_tier,
  'benefits_json',benefits_json,'reward_enabled',reward_enabled,'checkin_rewards',to_jsonb(checkin_rewards))
 FROM cinevjet.vip_plans WHERE id=plan
$$;

UPDATE cinevjet.vip_purchase_requests r SET plan_snapshot=cinevjet.vip_plan_contract(r.plan_id)
 || jsonb_build_object('name',r.plan_name,'price',r.amount,'duration_days',r.duration_days,
 'reward_tier',r.reward_tier,'benefits_json',r.benefits_json,'checkin_rewards',to_jsonb(r.reward_schedule))
WHERE plan_snapshot IS NULL;
UPDATE cinevjet.vip_subscriptions s SET plan_snapshot=COALESCE(
 (SELECT r.plan_snapshot FROM cinevjet.vip_purchase_requests r
  WHERE r.subscription_id=s.id OR 'VIP_PURCHASE/'||r.id=s.activation_reference LIMIT 1),
 cinevjet.vip_plan_contract(s.plan_id)) WHERE plan_snapshot IS NULL;

CREATE OR REPLACE FUNCTION cinevjet.capture_vip_purchase_contract() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.plan_snapshot IS NOT NULL AND NEW.plan_snapshot IS DISTINCT FROM OLD.plan_snapshot THEN
  RAISE EXCEPTION 'VIP purchase contract is immutable';
 END IF;
 IF NEW.plan_snapshot IS NULL THEN
  NEW.plan_snapshot := cinevjet.vip_plan_contract(NEW.plan_id)
   || jsonb_build_object('name',NEW.plan_name,'price',NEW.amount,'duration_days',NEW.duration_days,
    'reward_tier',NEW.reward_tier,'benefits_json',NEW.benefits_json,'checkin_rewards',to_jsonb(NEW.reward_schedule));
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER vip_purchase_contract BEFORE INSERT OR UPDATE OF plan_snapshot
 ON cinevjet.vip_purchase_requests FOR EACH ROW EXECUTE FUNCTION cinevjet.capture_vip_purchase_contract();
CREATE OR REPLACE FUNCTION cinevjet.capture_vip_subscription_contract() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.plan_snapshot IS NOT NULL AND NEW.plan_snapshot IS DISTINCT FROM OLD.plan_snapshot THEN
  RAISE EXCEPTION 'VIP subscription contract is immutable';
 END IF;
 IF NEW.plan_snapshot IS NULL THEN
  SELECT r.plan_snapshot INTO NEW.plan_snapshot FROM cinevjet.vip_purchase_requests r
   WHERE r.subscription_id=NEW.id OR 'VIP_PURCHASE/'||r.id=NEW.activation_reference LIMIT 1;
  NEW.plan_snapshot := COALESCE(NEW.plan_snapshot,cinevjet.vip_plan_contract(NEW.plan_id));
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER vip_subscription_contract BEFORE INSERT OR UPDATE OF plan_snapshot
 ON cinevjet.vip_subscriptions FOR EACH ROW EXECUTE FUNCTION cinevjet.capture_vip_subscription_contract();
ALTER TABLE cinevjet.vip_purchase_requests ALTER COLUMN plan_snapshot SET NOT NULL;
ALTER TABLE cinevjet.vip_subscriptions ALTER COLUMN plan_snapshot SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vip_payment_reference_unique ON cinevjet.vip_purchase_requests(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vip_bank_evidence_unique ON cinevjet.vip_purchase_requests(bank_evidence_reference) WHERE bank_evidence_reference IS NOT NULL;
-- A manual request now exists before transfer. An uploaded image never approves it.
ALTER TABLE cinevjet.vip_purchase_requests DROP CONSTRAINT IF EXISTS vip_payment_source;
ALTER TABLE cinevjet.vip_purchase_requests ADD CONSTRAINT vip_payment_source
 CHECK(provider IN ('MANUAL_BANK','PAYOS') AND ((bill_id IS NULL AND bill_url IS NULL) OR (bill_id IS NOT NULL AND bill_url IS NOT NULL)));
