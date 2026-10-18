-- Metadata and publication controls only. No media copies or financial changes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE cinevjet.short_sources (
 id text PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('TIKTOK','FACEBOOK')),
 source_url text NOT NULL, creator_name text NOT NULL,
 authorization_status text NOT NULL DEFAULT 'PENDING' CHECK(authorization_status IN ('PENDING','VERIFIED','REJECTED')),
 permission_evidence text NOT NULL DEFAULT '', sync_enabled boolean NOT NULL DEFAULT true,
 reviewed_by text REFERENCES cinevjet.users(id), last_synced_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,source_url), CHECK(authorization_status<>'VERIFIED' OR length(btrim(permission_evidence))>=12)
);
ALTER TABLE cinevjet.short_videos DROP CONSTRAINT short_videos_source_type_check;
ALTER TABLE cinevjet.short_videos ADD CONSTRAINT short_videos_source_type_check CHECK(source_type IN ('UPLOAD','EXTERNAL','DEMO','EMBED'));
ALTER TABLE cinevjet.short_videos
 ADD COLUMN provider text CHECK(provider IN ('TIKTOK','FACEBOOK')),
 ADD COLUMN provider_video_id text,
 ADD COLUMN original_url text,
 ADD COLUMN embed_url text,
 ADD COLUMN creator_url text,
 ADD COLUMN category text NOT NULL DEFAULT '',
 ADD COLUMN source_id text REFERENCES cinevjet.short_sources(id),
 ADD COLUMN permission_status text NOT NULL DEFAULT 'PENDING' CHECK(permission_status IN ('PENDING','VERIFIED','REJECTED')),
 ADD COLUMN permission_evidence text NOT NULL DEFAULT '',
 ADD COLUMN publish_status text NOT NULL DEFAULT 'PENDING' CHECK(publish_status IN ('PENDING','QUEUED','PUBLISHED','HIDDEN','REJECTED','UNAVAILABLE')),
 ADD COLUMN embed_status text NOT NULL DEFAULT 'PENDING' CHECK(embed_status IN ('PENDING','AVAILABLE','UNAVAILABLE','NEEDS_REVIEW')),
 ADD COLUMN reviewed_by text REFERENCES cinevjet.users(id),
 ADD COLUMN embed_confirmed_at timestamptz,
 ADD COLUMN published_at timestamptz,
 ADD COLUMN last_checked_at timestamptz,
 ADD COLUMN next_check_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN last_error text,
 ADD CONSTRAINT short_embed_contract CHECK(source_type<>'EMBED' OR (provider IS NOT NULL AND provider_video_id IS NOT NULL AND original_url IS NOT NULL AND embed_url IS NOT NULL AND source_id IS NOT NULL)),
 ADD CONSTRAINT short_embed_permission CHECK(source_type<>'EMBED' OR publish_status<>'PUBLISHED' OR (permission_status='VERIFIED' AND embed_status='AVAILABLE' AND length(btrim(permission_evidence))>=12));
CREATE UNIQUE INDEX shorts_provider_video_unique ON cinevjet.short_videos(provider,provider_video_id) WHERE provider IS NOT NULL;
CREATE INDEX shorts_social_queue_idx ON cinevjet.short_videos(next_check_at,created_at,id) WHERE source_type='EMBED' AND deleted_at IS NULL;
CREATE INDEX shorts_published_idx ON cinevjet.short_videos(display_order,COALESCE(published_at,created_at) DESC,id) WHERE is_active AND deleted_at IS NULL;
CREATE TABLE cinevjet.short_sync_control (
 id text PRIMARY KEY CHECK(id='default'), enabled boolean NOT NULL DEFAULT true,
 daily_target integer NOT NULL DEFAULT 3 CHECK(daily_target BETWEEN 1 AND 5),
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 lease_token text, leased_until timestamptz, CHECK(ends_at<=starts_at+interval '30 days')
);
INSERT INTO cinevjet.short_sync_control(id) VALUES('default');
CREATE TABLE cinevjet.short_sync_days (
 calendar_date date PRIMARY KEY, videos_added integer NOT NULL DEFAULT 0 CHECK(videos_added BETWEEN 0 AND 5)
);
-- Immutable first-publication history preserves quota even after hiding/re-approving a video.
CREATE TABLE cinevjet.short_publications (
 short_id text PRIMARY KEY REFERENCES cinevjet.short_videos(id),
 calendar_date date NOT NULL REFERENCES cinevjet.short_sync_days(calendar_date),
 published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX short_publications_day_idx ON cinevjet.short_publications(calendar_date);
CREATE TABLE cinevjet.short_sync_runs (
 id text PRIMARY KEY, trigger_type text NOT NULL CHECK(trigger_type IN ('CRON','ADMIN')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL DEFAULT 'RUNNING', candidates_checked integer NOT NULL DEFAULT 0,
 videos_added integer NOT NULL DEFAULT 0, videos_skipped integer NOT NULL DEFAULT 0,
 error_summary text
);
