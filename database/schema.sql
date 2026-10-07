-- Foundation schema only. No production migration has been executed.
-- Postgres integer VND / integer coins; never store movie binaries.
create table users (id uuid primary key, username text not null, email text unique not null, avatar_url text, created_at timestamptz not null default now());
create table genres (id uuid primary key, name text unique not null);
create table movies (
  id uuid primary key, title text not null, original_title text not null, slug text unique not null,
  description text not null, poster text not null, backdrop text not null, release_year smallint not null,
  country text not null, duration_seconds integer not null check (duration_seconds > 0), rating numeric(3,1) check (rating between 0 and 10),
  type text not null check (type in ('MOVIE','SERIES')), vip_required boolean not null default false,
  status text not null check (status in ('DRAFT','PUBLISHED')), created_at timestamptz not null default now()
);
create table movie_genres (movie_id uuid references movies(id) on delete cascade, genre_id uuid references genres(id), primary key(movie_id, genre_id));
create table seasons (id uuid primary key, movie_id uuid not null references movies(id), season_number integer not null check (season_number > 0), title text not null, unique(movie_id,season_number));
create table episodes (id uuid primary key, movie_id uuid not null references movies(id), season_id uuid not null references seasons(id), episode_number integer not null check (episode_number > 0), title text not null, duration_seconds integer not null check (duration_seconds > 0), thumbnail text, release_date date, unique(season_id,episode_number));
create table video_sources (id uuid primary key, movie_id uuid not null references movies(id), episode_id uuid references episodes(id), protocol text not null check (protocol in ('MP4','HLS','DASH')), url text not null, quality text not null, mime_type text not null, required_entitlement text);
create table subtitles (id uuid primary key, video_source_id uuid not null references video_sources(id), language text not null, label text not null, url text not null, format text not null default 'VTT');
create table watch_history (id uuid primary key, user_id uuid not null references users(id), movie_id uuid not null references movies(id), episode_id uuid references episodes(id), position_seconds integer not null check (position_seconds >= 0), duration_seconds integer not null check (duration_seconds > 0), updated_at timestamptz not null default now(), check(position_seconds <= duration_seconds));
create unique index watch_history_movie on watch_history(user_id,movie_id) where episode_id is null;
create unique index watch_history_episode on watch_history(user_id,episode_id) where episode_id is not null;
create index watch_history_recent on watch_history(user_id,updated_at desc);
create table favorites (user_id uuid references users(id), movie_id uuid references movies(id), created_at timestamptz not null default now(), primary key(user_id,movie_id));
create table coin_wallets (id uuid primary key, user_id uuid unique not null references users(id), asset text not null default 'COIN' check(asset='COIN'), balance bigint not null default 0 check(balance>=0));
create table coin_ledger (id uuid primary key, wallet_id uuid not null references coin_wallets(id), amount bigint not null check(amount<>0), reason text not null, idempotency_key text unique not null, created_at timestamptz not null default now());
create table checkin_config (id uuid primary key, timezone text not null, rewards jsonb not null, active boolean not null default true, check(jsonb_array_length(rewards)=7));
create table daily_checkins (id uuid primary key, user_id uuid not null references users(id), calendar_date date not null, timezone text not null, cycle_day smallint not null check(cycle_day between 1 and 7), config_id uuid not null references checkin_config(id), ledger_id uuid unique not null references coin_ledger(id), unique(user_id,calendar_date));
create table wallets (id uuid primary key, user_id uuid unique not null references users(id), asset text not null default 'CASH' check(asset='CASH'), currency text not null default 'VND', balance bigint not null default 0 check(balance>=0), reserved_balance bigint not null default 0 check(reserved_balance>=0), check(reserved_balance<=balance));
create table payment_methods (id uuid primary key, name text not null, kind text not null check(kind in ('BANK','E_WALLET','CARD')), provider_code text, active boolean not null default true);
create table deposits (id uuid primary key, user_id uuid not null references users(id), amount bigint not null check(amount>=50000), method_id uuid references payment_methods(id), status text not null check(status in ('PENDING','PROCESSING','COMPLETED','FAILED')), idempotency_key text unique not null, provider_reference text unique, created_at timestamptz not null default now());
create table withdrawals (id uuid primary key, user_id uuid not null references users(id), amount bigint not null check(amount>=50000), fee bigint not null check(fee>=0), net_amount bigint not null check(net_amount>0), method_id uuid references payment_methods(id), destination_encrypted text not null, status text not null check(status in ('PENDING','PROCESSING','COMPLETED','REJECTED')), idempotency_key text unique not null, created_at timestamptz not null default now(), check(net_amount=amount-fee));
create table wallet_ledger (id uuid primary key, wallet_id uuid not null references wallets(id), amount bigint not null check(amount<>0), kind text not null check(kind in ('DEPOSIT','WITHDRAWAL','VIP_PAYMENT','COIN_EXCHANGE')), deposit_id uuid references deposits(id), withdrawal_id uuid references withdrawals(id), idempotency_key text unique not null, created_at timestamptz not null default now());
create table vip_plans (id uuid primary key, code text unique not null, name text not null, price bigint not null check(price>=0), duration_days integer not null check(duration_days>=0), benefits jsonb not null, active boolean not null default true);
create table vip_subscriptions (id uuid primary key, user_id uuid not null references users(id), plan_id uuid not null references vip_plans(id), payment_ledger_id uuid unique not null references wallet_ledger(id), started_at timestamptz not null, expires_at timestamptz not null, status text not null check(status in ('ACTIVE','EXPIRED','CANCELLED')), check(expires_at>started_at));
create index vip_subscription_active on vip_subscriptions(user_id,expires_at) where status='ACTIVE';
create table notifications (id uuid primary key, user_id uuid not null references users(id), title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());
