-- Each VIP video mission now requires 30 seconds of verified playback.
ALTER TABLE cinevjet.daily_missions DROP CONSTRAINT IF EXISTS daily_missions_target_seconds_check;
ALTER TABLE cinevjet.daily_missions ADD CONSTRAINT daily_missions_target_seconds_check CHECK(target_seconds BETWEEN 30 AND 86400);
UPDATE cinevjet.daily_missions
SET target_seconds=30
WHERE id ~ '^VIP_[1-6]_TASK_[0-9]+$';
