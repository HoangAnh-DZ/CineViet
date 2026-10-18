-- Catalog metadata only. No user, payment, wallet, VIP or rewards tables are changed.
ALTER TABLE cinevjet.movies
  ADD COLUMN language text NOT NULL DEFAULT '',
  ADD COLUMN duration_seconds integer CHECK (duration_seconds > 0),
  ADD COLUMN license_name text NOT NULL DEFAULT '',
  ADD COLUMN license_url text NOT NULL DEFAULT '',
  ADD COLUMN license_source_url text NOT NULL DEFAULT '',
  ADD COLUMN source_page_url text NOT NULL DEFAULT '',
  ADD COLUMN attribution text NOT NULL DEFAULT '',
  ADD COLUMN poster_attribution text NOT NULL DEFAULT '',
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE cinevjet.movies ALTER COLUMN rating DROP NOT NULL;
