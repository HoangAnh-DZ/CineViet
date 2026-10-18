export interface ShortVideo {
  id: string;
  movie_id: string | null;
  movie_slug: string | null;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  source: string;
  creator_name: string | null;
  hashtags: string[];
  source_type: "UPLOAD" | "EXTERNAL" | "DEMO" | "EMBED";
  provider?: "TIKTOK" | "FACEBOOK" | null;
  provider_video_id?: string | null;
  original_url?: string | null;
  embed_url?: string | null;
  creator_url?: string | null;
  published_at?: string | null;
}
export interface AdminShort extends ShortVideo {
  episode_id: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  movie_title: string | null;
  stored_thumbnail_url: string | null;
}
export interface ShortsBatch {
  items: ShortVideo[];
  nextCursor: string | null;
}
export const SHORT_BATCH_SIZE = 5;
export function shortHref(id: string) {
  return `/shorts?id=${encodeURIComponent(id)}`;
}
export function preloadShort(index: number, active: number): "auto" | "metadata" | "none" {
  return index === active ? "auto" : index === active + 1 ? "metadata" : "none";
}
