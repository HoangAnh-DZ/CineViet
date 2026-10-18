-- Additive: existing identities, content and financial tables are untouched.
CREATE TABLE IF NOT EXISTS cinevjet.admin_users (
 user_id text PRIMARY KEY REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cinevjet.short_videos (
 id text PRIMARY KEY,
 movie_id text REFERENCES cinevjet.movies(id) ON DELETE SET NULL,
 episode_id text REFERENCES cinevjet.episodes(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '', creator_name text,
 video_url text NOT NULL, thumbnail_url text, duration_seconds integer CHECK(duration_seconds > 0),
 hashtags jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(hashtags) = 'array'),
 display_order integer NOT NULL DEFAULT 0,
 is_active boolean NOT NULL DEFAULT true,
 source_type text NOT NULL CHECK(source_type IN ('UPLOAD','EXTERNAL','DEMO')),
 source_credit text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CHECK(episode_id IS NULL OR movie_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS shorts_feed_idx ON cinevjet.short_videos(display_order,created_at DESC,id) WHERE is_active AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS cinevjet.short_uploads (
 url text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id),
 kind text NOT NULL CHECK(kind IN ('video','thumbnail')),
 content_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
