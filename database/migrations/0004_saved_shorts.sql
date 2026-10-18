-- Personal bookmarks only. Existing history, reward and finance tables are unchanged.
CREATE TABLE IF NOT EXISTS cinevjet.saved_shorts (
 user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 short_id text NOT NULL REFERENCES cinevjet.short_videos(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,short_id)
);
CREATE INDEX IF NOT EXISTS saved_shorts_recent_idx ON cinevjet.saved_shorts(user_id,created_at DESC);
