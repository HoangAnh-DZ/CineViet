-- Additive only: no changes to existing wallets, ledger, check-ins or catalog.
CREATE TABLE cinevjet.daily_missions (
 id text PRIMARY KEY, target_seconds integer NOT NULL CHECK(target_seconds BETWEEN 60 AND 86400),
 reward integer NOT NULL CHECK(reward BETWEEN 1 AND 1000000), enabled boolean NOT NULL DEFAULT true
);
INSERT INTO cinevjet.daily_missions(id,target_seconds,reward) VALUES
 ('WATCH_10',600,100),('WATCH_30',1800,200),('WATCH_60',3600,400)
 ON CONFLICT(id) DO NOTHING;
CREATE TABLE cinevjet.daily_watch_progress (
 user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE, calendar_date date NOT NULL,
 watched_ms bigint NOT NULL DEFAULT 0 CHECK(watched_ms BETWEEN 0 AND 86400000),
 PRIMARY KEY(user_id,calendar_date)
);
-- A single lease per user serializes all tabs. Tokens rotate after each accepted heartbeat.
CREATE TABLE cinevjet.reward_watch_sessions (
 user_id text PRIMARY KEY REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 id uuid NOT NULL, source_id text NOT NULL REFERENCES cinevjet.video_sources(id) ON DELETE CASCADE,
 nonce uuid NOT NULL, previous_nonce uuid, request_hash text,
 last_at timestamptz NOT NULL, position_seconds double precision NOT NULL CHECK(position_seconds>=0),
 playing boolean NOT NULL DEFAULT false
);
CREATE TABLE cinevjet.daily_mission_claims (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 mission_id text NOT NULL REFERENCES cinevjet.daily_missions(id), calendar_date date NOT NULL,
 reward integer NOT NULL CHECK(reward>0), created_at timestamptz NOT NULL,
 UNIQUE(user_id,mission_id,calendar_date)
);
