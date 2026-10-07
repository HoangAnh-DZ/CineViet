-- Additive migration. Dedicated schema avoids altering any existing public/demo tables.
CREATE SCHEMA IF NOT EXISTS cinevjet;
CREATE TABLE cinevjet.users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE CHECK(email = lower(btrim(email))),
 password_hash text NOT NULL, display_name text NOT NULL, avatar_url text,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cinevjet.sessions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON cinevjet.sessions(user_id);
CREATE INDEX sessions_expiry_idx ON cinevjet.sessions(expires_at);
CREATE TABLE cinevjet.auth_limits (key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE cinevjet.movies (
 id text PRIMARY KEY, title text NOT NULL, original_title text NOT NULL, slug text NOT NULL UNIQUE,
 description text NOT NULL, poster_url text NOT NULL, backdrop_url text NOT NULL,
 release_year integer NOT NULL CHECK(release_year BETWEEN 1888 AND 2200), country text NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes > 0), rating numeric(3,1) NOT NULL CHECK(rating BETWEEN 0 AND 10),
 type text NOT NULL CHECK(type IN ('MOVIE','SERIES')), vip_required boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','HIDDEN')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movies_catalog_idx ON cinevjet.movies(status,type,release_year DESC,id);
CREATE TABLE cinevjet.genres (id text PRIMARY KEY, name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE);
CREATE TABLE cinevjet.movie_genres (
 movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE,
 genre_id text NOT NULL REFERENCES cinevjet.genres(id) ON DELETE CASCADE, PRIMARY KEY(movie_id,genre_id)
);
CREATE INDEX movie_genres_genre_idx ON cinevjet.movie_genres(genre_id,movie_id);
CREATE TABLE cinevjet.seasons (
 id text PRIMARY KEY, movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE,
 season_number integer NOT NULL CHECK(season_number > 0), title text NOT NULL, UNIQUE(movie_id,season_number)
);
CREATE TABLE cinevjet.episodes (
 id text PRIMARY KEY, movie_id text NOT NULL, season_number integer NOT NULL, episode_number integer NOT NULL CHECK(episode_number > 0),
 title text NOT NULL, description text NOT NULL DEFAULT '', duration_seconds integer NOT NULL CHECK(duration_seconds > 0),
 thumbnail_url text NOT NULL, release_date date, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','HIDDEN')),
 FOREIGN KEY(movie_id,season_number) REFERENCES cinevjet.seasons(movie_id,season_number) ON DELETE CASCADE,
 UNIQUE(movie_id,season_number,episode_number), UNIQUE(id,movie_id)
);
CREATE TABLE cinevjet.video_sources (
 id text PRIMARY KEY, movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE, episode_id text,
 provider text NOT NULL, playback_url text NOT NULL, quality text NOT NULL CHECK(quality IN ('AUTO','720p','1080p')),
 format text NOT NULL CHECK(format IN ('MP4','HLS','DASH')), is_active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(episode_id,movie_id) REFERENCES cinevjet.episodes(id,movie_id) ON DELETE CASCADE
);
CREATE INDEX video_sources_movie_idx ON cinevjet.video_sources(movie_id,episode_id) WHERE is_active;
CREATE TABLE cinevjet.subtitles (
 id text PRIMARY KEY, movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE, episode_id text,
 language text NOT NULL, label text NOT NULL, url text NOT NULL, format text NOT NULL DEFAULT 'VTT' CHECK(format IN ('VTT','SRT')),
 is_default boolean NOT NULL DEFAULT false, FOREIGN KEY(episode_id,movie_id) REFERENCES cinevjet.episodes(id,movie_id) ON DELETE CASCADE
);
CREATE TABLE cinevjet.watch_history (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE, episode_id text,
 position_seconds integer NOT NULL CHECK(position_seconds >= 0), duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 1 AND 86400),
 completed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(position_seconds <= duration_seconds), FOREIGN KEY(episode_id,movie_id) REFERENCES cinevjet.episodes(id,movie_id) ON DELETE CASCADE,
 UNIQUE NULLS NOT DISTINCT(user_id,movie_id,episode_id)
);
CREATE INDEX watch_history_recent_idx ON cinevjet.watch_history(user_id,updated_at DESC);
CREATE TABLE cinevjet.favorites (
 user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE, movie_id text NOT NULL REFERENCES cinevjet.movies(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,movie_id)
);
CREATE TABLE cinevjet.coin_wallets (
 user_id text PRIMARY KEY REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE cinevjet.coin_ledger (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.coin_wallets(user_id), amount bigint NOT NULL CHECK(amount <> 0),
 type text NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,reference_type,reference_id)
);
CREATE INDEX coin_ledger_recent_idx ON cinevjet.coin_ledger(user_id,created_at DESC);
CREATE TABLE cinevjet.daily_checkins (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id), checkin_date date NOT NULL,
 reward integer NOT NULL CHECK(reward > 0), timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,checkin_date)
);
CREATE TABLE cinevjet.wallets (
 user_id text PRIMARY KEY REFERENCES cinevjet.users(id) ON DELETE CASCADE, currency text NOT NULL DEFAULT 'VND' CHECK(currency = 'VND'),
 balance bigint NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 9007199254740991),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND balance)
);
CREATE TABLE cinevjet.wallet_ledger (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.wallets(user_id), amount bigint NOT NULL CHECK(amount <> 0),
 type text NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,reference_type,reference_id)
);
CREATE INDEX wallet_ledger_recent_idx ON cinevjet.wallet_ledger(user_id,created_at DESC);
CREATE TABLE cinevjet.deposits (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.wallets(user_id), amount bigint NOT NULL CHECK(amount BETWEEN 50000 AND 100000000),
 provider text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cinevjet.withdrawals (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.wallets(user_id), amount bigint NOT NULL CHECK(amount BETWEEN 50000 AND 100000000),
 fee bigint NOT NULL CHECK(fee >= 0 AND fee < amount), destination text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED','REJECTED')),
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cinevjet.vip_plans (
 id text PRIMARY KEY, name text NOT NULL, price bigint NOT NULL CHECK(price BETWEEN 0 AND 9007199254740991),
 duration_days integer NOT NULL CHECK(duration_days >= 0), benefits_json jsonb NOT NULL DEFAULT '[]',
 active boolean NOT NULL DEFAULT true, discount integer NOT NULL DEFAULT 0
);
CREATE TABLE cinevjet.vip_subscriptions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id), plan_id text NOT NULL REFERENCES cinevjet.vip_plans(id),
 started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','CANCELLED')), CHECK(expires_at > started_at)
);
CREATE INDEX vip_subscriptions_user_idx ON cinevjet.vip_subscriptions(user_id,expires_at DESC);
CREATE TABLE cinevjet.notifications (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES cinevjet.users(id) ON DELETE CASCADE,
 title text NOT NULL, body text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recent_idx ON cinevjet.notifications(user_id,created_at DESC);
