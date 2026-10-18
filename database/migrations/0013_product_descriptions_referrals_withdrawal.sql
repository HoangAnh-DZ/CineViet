-- Catalog descriptions and future withdrawal configuration only.
-- Never modifies balances, ledger entries, purchases, subscriptions or pending fees.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE cinevjet.vip_plans ADD COLUMN IF NOT EXISTS additional_amount bigint NOT NULL DEFAULT 0 CHECK(additional_amount BETWEEN 0 AND 10000000000);
UPDATE cinevjet.vip_plans p SET additional_amount=v.additional
FROM (VALUES ('VIP_1',150000,75000),('VIP_2',300000,120000),('VIP_3',500000,180000),('VIP_4',1000000,240000),('VIP_5',2000000,300000),('VIP_6',5000000,375000)) v(id,price,additional)
WHERE p.id=v.id AND p.price=v.price;
ALTER TABLE cinevjet.system_settings ADD COLUMN IF NOT EXISTS withdrawal_fee_bps integer NOT NULL DEFAULT 400 CHECK(withdrawal_fee_bps=400);
UPDATE cinevjet.system_settings SET min_withdrawal=35000 WHERE id='default' AND min_withdrawal=50000;
-- Widen the allowed minimum; every existing row remains valid.
ALTER TABLE cinevjet.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_amount_check;
ALTER TABLE cinevjet.withdrawals ADD CONSTRAINT withdrawals_amount_check CHECK(amount BETWEEN 35000 AND 100000000);
CREATE TABLE IF NOT EXISTS cinevjet.referral_policy_drafts (
  id text PRIMARY KEY CHECK(id='default'),
  level1_percent integer NOT NULL CHECK(level1_percent BETWEEN 0 AND 100),
  level2_percent integer NOT NULL CHECK(level2_percent BETWEEN 0 AND 100),
  level3_percent integer NOT NULL CHECK(level3_percent BETWEEN 0 AND 100),
  status text NOT NULL CHECK(status='DRAFT')
);
INSERT INTO cinevjet.referral_policy_drafts VALUES('default',20,5,1,'DRAFT') ON CONFLICT(id) DO NOTHING;
-- Registration assigns one existing parent to a new ID. Prevent reassignment,
-- self-referral and cycles even if a future write path bypasses registration.
CREATE OR REPLACE FUNCTION cinevjet.guard_referral_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; visited text[] := ARRAY[NEW.id];
BEGIN
  IF TG_OP='UPDATE' AND NEW.referred_by IS DISTINCT FROM OLD.referred_by AND NEW.referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'Referral parent cannot be reassigned';
  END IF;
  parent_id := NEW.referred_by;
  WHILE parent_id IS NOT NULL LOOP
    IF parent_id=ANY(visited) OR cardinality(visited)>256 THEN RAISE EXCEPTION 'Invalid referral ancestry'; END IF;
    visited := array_append(visited,parent_id);
    SELECT referred_by INTO parent_id FROM cinevjet.users WHERE id=parent_id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_referral_parent BEFORE INSERT OR UPDATE OF referred_by ON cinevjet.users FOR EACH ROW EXECUTE FUNCTION cinevjet.guard_referral_parent();
