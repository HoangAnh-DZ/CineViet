-- Import the existing five licensed clips. Never overwrite an admin edit.
WITH demo AS (
 SELECT m.*, row_number() OVER(ORDER BY release_year DESC,created_at DESC,id) AS n
 FROM cinevjet.movies m WHERE status='PUBLISHED'
)
INSERT INTO cinevjet.short_videos(id,movie_id,title,description,creator_name,video_url,thumbnail_url,duration_seconds,hashtags,display_order,is_active,source_type,source_credit)
SELECT 'demo-'||id,id,title,'Một khoảnh khắc hoạt hình từ Big Buck Bunny. Video mẫu cho CineVjet.',
 'Blender Foundation','/video/shorts/bunny-'||n||'.mp4','/video/shorts/bunny-'||n||'.jpg',6,
 '["#hoathinh","#khampha","#cinevjet"]'::jsonb,n::int,true,'DEMO','Big Buck Bunny · CC BY 3.0'
FROM demo WHERE n <= 5 ON CONFLICT(id) DO NOTHING;
