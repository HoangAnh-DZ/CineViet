-- Apply only AFTER the snapshot-aware application is serving production.
-- Update the sale catalog; never recalculate purchased contracts or financial data.
DO $$ BEGIN
 IF (SELECT count(*) FROM cinevjet.vip_plans WHERE
  (id='VIP_1' AND price=150000) OR (id='VIP_2' AND price=300000) OR
  (id='VIP_3' AND price=500000) OR (id='VIP_4' AND price=1000000) OR
  (id='VIP_5' AND price=2000000) OR (id='VIP_6' AND price=5000000)) <> 6 THEN
  RAISE EXCEPTION 'VIP prices differ from the authorized catalog; stop for review';
 END IF;
END $$;
UPDATE cinevjet.vip_plans p SET name=v.name,duration_days=15,mission_count=v.videos,mission_reward=v.coins
FROM (VALUES
 ('VIP_1','VIP 1',5,2600),('VIP_2','VIP 2',8,3375),('VIP_3','VIP 3',12,3889),
 ('VIP_4','VIP 4',16,5917),('VIP_5','VIP 5',20,9667),('VIP_6','VIP 6',25,19333)
) AS v(id,name,videos,coins) WHERE p.id=v.id;
