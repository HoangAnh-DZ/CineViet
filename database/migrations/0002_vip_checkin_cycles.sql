-- Additive reward configuration; legacy subscriptions and all existing history remain intact.
CREATE FUNCTION cinevjet.valid_reward_schedule(rewards integer[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT cardinality(rewards)=7 AND array_lower(rewards,1)=1
   AND NOT EXISTS(SELECT 1 FROM unnest(rewards) r WHERE r IS NULL OR r<=0)
$$;
CREATE FUNCTION cinevjet.reward_now() RETURNS timestamptz
LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$;
ALTER TABLE cinevjet.vip_plans
 ADD COLUMN reward_tier text CHECK(reward_tier IN ('FREE','VIP_BASIC','VIP_PLUS','VIP_PREMIUM')),
 ADD COLUMN checkin_rewards integer[] CHECK(cinevjet.valid_reward_schedule(checkin_rewards)),
 ADD COLUMN reward_enabled boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX vip_plans_reward_tier_idx ON cinevjet.vip_plans(reward_tier) WHERE reward_tier IS NOT NULL;
UPDATE cinevjet.vip_plans SET name='Free',price=0,reward_tier='FREE',checkin_rewards=ARRAY[200,300,500,700,1000,1300,2000] WHERE id='FREE';
INSERT INTO cinevjet.vip_plans(id,name,price,duration_days,benefits_json,reward_tier,checkin_rewards) VALUES
 ('VIP_BASIC','VIP Basic',49000,30,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]','VIP_BASIC',ARRAY[5000,7000,9000,12000,15000,20000,31000]),
 ('VIP_PLUS','VIP Plus',99000,30,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE"]','VIP_PLUS',ARRAY[8000,10000,15000,18000,22000,30000,46000]),
 ('VIP_PREMIUM','VIP Premium',199000,30,'["VIP_MOVIES","FULL_HD","NO_ADS","VIP_BADGE","EARLY_ACCESS"]','VIP_PREMIUM',ARRAY[12000,18000,25000,30000,40000,50000,74000]);
-- Only a trusted payment/activation service may record verified references.
-- There is deliberately no public activation endpoint or demo-payment integration.
ALTER TABLE cinevjet.vip_subscriptions
 ADD COLUMN activation_reference text UNIQUE,
 ADD COLUMN activation_verified_at timestamptz,
 ADD CONSTRAINT vip_activation_verified CHECK((activation_reference IS NULL)=(activation_verified_at IS NULL));
CREATE TABLE cinevjet.vip_checkin_cycles (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES cinevjet.users(id),
 vip_subscription_id text NOT NULL UNIQUE REFERENCES cinevjet.vip_subscriptions(id),
 vip_plan_id text NOT NULL REFERENCES cinevjet.vip_plans(id),
 purchase_reference text NOT NULL UNIQUE,
 tier text NOT NULL CHECK(tier IN ('VIP_BASIC','VIP_PLUS','VIP_PREMIUM')),
 -- Snapshot the purchased reward contract so later admin edits do not alter an unfinished cycle.
 reward_schedule integer[] NOT NULL CHECK(cinevjet.valid_reward_schedule(reward_schedule)),
 plan_price bigint NOT NULL CHECK(plan_price BETWEEN 1 AND 9007199254740991),
 started_at timestamptz NOT NULL,
 completed_at timestamptz,
 current_day integer NOT NULL DEFAULT 0 CHECK(current_day BETWEEN 0 AND 7),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','EXPIRED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='COMPLETED')=(current_day=7)),
 CHECK((status='COMPLETED')=(completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX vip_checkin_one_active_idx ON cinevjet.vip_checkin_cycles(user_id) WHERE status='ACTIVE';
CREATE INDEX vip_checkin_user_idx ON cinevjet.vip_checkin_cycles(user_id,created_at DESC);
ALTER TABLE cinevjet.daily_checkins
 ADD COLUMN cycle_day integer CHECK(cycle_day BETWEEN 1 AND 7),
 ADD COLUMN reward_tier text NOT NULL DEFAULT 'FREE' CHECK(reward_tier IN ('FREE','VIP_BASIC','VIP_PLUS','VIP_PREMIUM')),
 ADD COLUMN vip_checkin_cycle_id text REFERENCES cinevjet.vip_checkin_cycles(id),
 ADD CONSTRAINT vip_checkin_day_unique UNIQUE(vip_checkin_cycle_id,cycle_day),
 ADD CONSTRAINT daily_checkin_tier_cycle CHECK((reward_tier='FREE')=(vip_checkin_cycle_id IS NULL));
