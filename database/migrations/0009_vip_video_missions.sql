-- Additive VIP mission contract. Existing subscriptions and ledger rows remain intact.
ALTER TABLE cinevjet.vip_plans
  ADD COLUMN IF NOT EXISTS purchase_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mission_count integer NOT NULL DEFAULT 0 CHECK(mission_count BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS mission_reward bigint NOT NULL DEFAULT 0 CHECK(mission_reward >= 0);

ALTER TABLE cinevjet.vip_plans DROP CONSTRAINT IF EXISTS vip_plans_reward_tier_check;
ALTER TABLE cinevjet.vip_plans ADD CONSTRAINT vip_plans_reward_tier_check
  CHECK(reward_tier IS NULL OR reward_tier IN ('FREE','VIP_BASIC','VIP_PLUS','VIP_PREMIUM','VIP_1','VIP_2','VIP_3','VIP_4','VIP_5','VIP_6'));
ALTER TABLE cinevjet.vip_purchase_requests DROP CONSTRAINT IF EXISTS vip_purchase_requests_reward_tier_check;
ALTER TABLE cinevjet.vip_purchase_requests ADD CONSTRAINT vip_purchase_requests_reward_tier_check
  CHECK(reward_tier IN ('VIP_BASIC','VIP_PLUS','VIP_PREMIUM','VIP_1','VIP_2','VIP_3','VIP_4','VIP_5','VIP_6'));

-- Legacy plans stay available to historical subscriptions but are no longer offered for new purchases.
UPDATE cinevjet.vip_plans SET purchase_enabled=false WHERE id IN ('VIP_BASIC','VIP_PLUS','VIP_PREMIUM');
UPDATE cinevjet.daily_missions SET enabled=false WHERE id IN ('WATCH_10','WATCH_30','WATCH_60');

INSERT INTO cinevjet.vip_plans(id,name,price,duration_days,benefits_json,active,discount,reward_tier,checkin_rewards,reward_enabled,purchase_enabled,mission_count,mission_reward)
VALUES
 ('VIP_1','VIP 1',150000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]',true,0,'VIP_1',ARRAY[200,300,500,700,1000,1300,2000],false,true,5,3000),
 ('VIP_2','VIP 2',300000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]',true,0,'VIP_2',ARRAY[200,300,500,700,1000,1300,2000],false,true,8,6000),
 ('VIP_3','VIP 3',500000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]',true,0,'VIP_3',ARRAY[200,300,500,700,1000,1300,2000],false,true,12,10000),
 ('VIP_4','VIP 4',1000000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]',true,0,'VIP_4',ARRAY[200,300,500,700,1000,1300,2000],false,true,16,20000),
 ('VIP_5','VIP 5',2000000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]',true,0,'VIP_5',ARRAY[200,300,500,700,1000,1300,2000],false,true,20,40000),
 ('VIP_6','VIP 6',5000000,15,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE","EARLY_ACCESS"]',true,0,'VIP_6',ARRAY[200,300,500,700,1000,1300,2000],false,true,25,100000)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,duration_days=excluded.duration_days,benefits_json=excluded.benefits_json,active=true,reward_tier=excluded.reward_tier,checkin_rewards=excluded.checkin_rewards,reward_enabled=false,purchase_enabled=true,mission_count=excluded.mission_count,mission_reward=excluded.mission_reward;

DO $$
DECLARE tier integer; task integer;
BEGIN
  FOR tier IN 1..6 LOOP
    FOR task IN 1..25 LOOP
      INSERT INTO cinevjet.daily_missions(id,target_seconds,reward,enabled)
      VALUES('VIP_' || tier || '_TASK_' || task,600,1,true)
      ON CONFLICT(id) DO UPDATE SET target_seconds=600,enabled=true;
    END LOOP;
  END LOOP;
END $$;
