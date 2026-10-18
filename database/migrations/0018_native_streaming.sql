-- Additive native playback capability. No catalog, balances or financial records are changed.
ALTER TABLE cinevjet.video_sources ADD COLUMN IF NOT EXISTS bitrate_bps integer CHECK (bitrate_bps > 0 AND bitrate_bps <= 100000000);
ALTER TABLE cinevjet.video_sources ADD COLUMN IF NOT EXISTS provenance jsonb;
ALTER TABLE cinevjet.video_sources DROP CONSTRAINT IF EXISTS video_sources_format_check;
ALTER TABLE cinevjet.video_sources ADD CONSTRAINT video_sources_format_check CHECK(format IN ('MP4','WEBM','HLS','DASH'));
ALTER TABLE cinevjet.video_sources DROP CONSTRAINT IF EXISTS video_sources_quality_check;
ALTER TABLE cinevjet.video_sources ADD CONSTRAINT video_sources_quality_check CHECK(quality IN ('AUTO','240p','360p','480p','720p','1080p'));
