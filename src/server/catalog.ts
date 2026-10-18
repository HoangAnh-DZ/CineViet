import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { database } from "./db";
import { catalogSchema } from "./validation";
import type { Movie, Episode, VideoSource, Subtitle } from "@/domain/models";
const movieFields = sql`m.*, COALESCE((SELECT json_agg(g.name ORDER BY g.name) FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id),'[]') AS genres,
 (SELECT count(*)::int FROM cinevjet.episodes e WHERE e.movie_id=m.id AND e.status='PUBLISHED') AS episode_count`;
function publicSourceCredit(value: unknown): VideoSource["credit"] {
  if (!value || typeof value !== "object") return undefined;
  const credit: NonNullable<VideoSource["credit"]> = {};
  for (const key of [
    "license_name",
    "license_url",
    "license_source_url",
    "source_page_url",
    "attribution",
    "poster_attribution",
  ] as const) {
    const text = (value as Record<string, unknown>)[key];
    if (typeof text === "string" && text.trim()) credit[key] = text;
  }
  return Object.keys(credit).length ? credit : undefined;
}
export function mapMovie(row: Record<string, unknown>): Movie {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    original_title: String(row.original_title),
    description: String(row.description),
    poster: String(row.poster_url),
    backdrop: String(row.backdrop_url),
    release_year: Number(row.release_year),
    country: String(row.country),
    duration: Number(row.duration_minutes),
    rating: row.rating == null ? null : Number(row.rating),
    language: String(row.language || ""),
    duration_seconds: row.duration_seconds == null ? undefined : Number(row.duration_seconds),
    license_name: String(row.license_name || ""),
    license_url: String(row.license_url || ""),
    license_source_url: String(row.license_source_url || ""),
    source_page_url: String(row.source_page_url || ""),
    attribution: String(row.attribution || ""),
    poster_attribution: String(row.poster_attribution || ""),
    type: row.type as Movie["type"],
    status: row.status as Movie["status"],
    vip_required: Boolean(row.vip_required),
    genres: row.genres as string[],
    episode_count: row.episode_count == null ? undefined : Number(row.episode_count),
  };
}
async function list(where: SQL, order: SQL, limit: number) {
  const result = await database().execute(
    sql`SELECT ${movieFields} FROM cinevjet.movies m WHERE m.status='PUBLISHED' AND NOT m.is_demo AND ${where} ORDER BY ${order} LIMIT ${limit}`,
  );
  return result.rows.map(mapMovie);
}
export async function homeCatalog() {
  const [trending, newest, series, recommended, shortSeries] = await Promise.all([
    list(sql`true`, sql`m.release_year DESC,m.id`, 6),
    list(sql`true`, sql`m.created_at DESC,m.id`, 6),
    list(
      sql`m.type='SERIES' AND NOT EXISTS (SELECT 1 FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id AND g.name='Series tập ngắn')`,
      sql`m.created_at DESC,m.id`,
      6,
    ),
    list(
      sql`m.vip_required=false AND m.type='MOVIE' AND m.duration_minutes>=40`,
      sql`m.release_year DESC,m.id`,
      6,
    ),
    list(
      sql`m.type='SERIES' AND EXISTS (SELECT 1 FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id AND g.name='Series tập ngắn')`,
      sql`m.created_at DESC,m.id`,
      6,
    ),
  ]);
  return { featured: trending.slice(0, 3), trending, newest, series, recommended, shortSeries };
}
export async function findMovie(id: string) {
  const result = await database().execute(
    sql`SELECT ${movieFields} FROM cinevjet.movies m WHERE (m.id=${id} OR m.slug=${id}) AND m.status='PUBLISHED' AND NOT m.is_demo LIMIT 1`,
  );
  return result.rows[0] ? mapMovie(result.rows[0]) : null;
}
export async function movieEpisodes(id: string): Promise<Episode[]> {
  const result = await database().execute(
    sql`SELECT id,movie_id,season_number,episode_number,title,description,duration_seconds,thumbnail_url,release_date FROM cinevjet.episodes WHERE movie_id=${id} AND status='PUBLISHED' ORDER BY season_number,episode_number`,
  );
  return result.rows.map((r) => ({
    id: String(r.id),
    movie_id: String(r.movie_id),
    season: Number(r.season_number),
    episode_number: Number(r.episode_number),
    title: String(r.title || "").trim(),
    description: String(r.description || "").trim(),
    duration: Number(r.duration_seconds),
    thumbnail: String(r.thumbnail_url || ""),
    release_date: r.release_date ? String(r.release_date) : "",
  }));
}
// Public provenance only; playback URLs, disabled sources and unpublished episodes stay private.
export async function movieSourceCredits(id: string) {
  const rows = await database()
    .execute(sql`SELECT s.id,s.provenance,e.title AS episode_title,e.episode_number
    FROM cinevjet.video_sources s LEFT JOIN cinevjet.episodes e ON e.id=s.episode_id
    WHERE s.movie_id=${id} AND s.is_active AND (s.episode_id IS NULL OR e.status='PUBLISHED') ORDER BY e.episode_number NULLS FIRST,s.id`);
  return rows.rows.flatMap((r) => {
    const credit = publicSourceCredit(r.provenance);
    return credit?.license_name
      ? [
          {
            id: String(r.id),
            title: r.episode_number
              ? `Tập ${r.episode_number}${r.episode_title ? ` · ${r.episode_title}` : ""}`
              : "Nguồn phim",
            credit,
          },
        ]
      : [];
  });
}
export async function relatedMovies(id: string) {
  return list(
    sql`m.id<>${id} AND EXISTS(SELECT 1 FROM cinevjet.movie_genres a JOIN cinevjet.movie_genres b ON a.genre_id=b.genre_id WHERE a.movie_id=m.id AND b.movie_id=${id})`,
    sql`m.rating DESC NULLS LAST,m.id`,
    6,
  );
}
export async function playback(id: string, episodeId?: string) {
  const condition = episodeId ? sql`episode_id=${episodeId}` : sql`episode_id IS NULL`;
  const [sources, subtitles] = await Promise.all([
    database().execute(
      sql`SELECT * FROM cinevjet.video_sources WHERE movie_id=${id} AND ${condition} AND is_active ORDER BY quality,id`,
    ),
    database().execute(
      sql`SELECT * FROM cinevjet.subtitles WHERE movie_id=${id} AND ${condition} ORDER BY is_default DESC,id`,
    ),
  ]);
  return {
    sources: sources.rows.map((r) => ({
      id: String(r.id),
      movie_id: id,
      episode_id: episodeId,
      protocol: r.format,
      url: r.playback_url,
      quality: r.quality,
      bitrate_bps: r.bitrate_bps == null ? undefined : Number(r.bitrate_bps),
      credit: publicSourceCredit(r.provenance),
      mime_type:
        r.format === "MP4"
          ? "video/mp4"
          : r.format === "WEBM"
            ? "video/webm"
            : "application/vnd.apple.mpegurl",
    })) as VideoSource[],
    subtitles: subtitles.rows
      .filter((r) => r.format === "VTT")
      .map((r) => ({
        id: String(r.id),
        video_source_id: String(sources.rows[0]?.id || ""),
        language: String(r.language),
        label: String(r.label),
        url: String(r.url),
        format: "VTT" as const,
      })) as Subtitle[],
  };
}
export async function catalogOptions() {
  const result = await database().execute(sql`SELECT
    ARRAY(SELECT g.name FROM cinevjet.genres g WHERE EXISTS (SELECT 1 FROM cinevjet.movie_genres mg JOIN cinevjet.movies m ON m.id=mg.movie_id WHERE mg.genre_id=g.id AND m.status='PUBLISHED' AND NOT m.is_demo) ORDER BY g.name) AS genres,
    ARRAY(SELECT DISTINCT country FROM cinevjet.movies WHERE status='PUBLISHED' AND NOT is_demo ORDER BY country) AS countries,
    ARRAY(SELECT DISTINCT release_year FROM cinevjet.movies WHERE status='PUBLISHED' AND NOT is_demo ORDER BY release_year DESC) AS years`);
  const options = result.rows[0] as { genres: string[]; countries: string[]; years: number[] };
  return {
    genres: ["Tất cả", "Phim lẻ", "Phim bộ", ...options.genres],
    countries: options.countries,
    years: options.years,
  };
}
export async function publicMoviePages() {
  const result = await database().execute(
    sql`SELECT slug,updated_at FROM cinevjet.movies WHERE status='PUBLISHED' AND NOT is_demo ORDER BY slug LIMIT 49999`,
  );
  return result.rows.map((row) => ({
    slug: String(row.slug),
    updatedAt: new Date(String(row.updated_at)),
  }));
}
export async function searchCatalog(input: unknown) {
  const filters = catalogSchema.parse(input);
  const conditions: SQL[] = [sql`m.status='PUBLISHED' AND NOT m.is_demo`];
  if (filters.q) {
    const q = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`(m.title ILIKE ${q} OR m.original_title ILIKE ${q})`);
  }
  const type =
    filters.type ||
    (filters.genre === "Phim lẻ" ? "MOVIE" : filters.genre === "Phim bộ" ? "SERIES" : "");
  if (type) conditions.push(sql`m.type=${type}`);
  if (!["Tất cả", "Phim lẻ", "Phim bộ"].includes(filters.genre))
    conditions.push(
      sql`EXISTS(SELECT 1 FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id AND (g.name=${filters.genre} OR g.slug=${filters.genre}))`,
    );
  if (filters.country) conditions.push(sql`m.country=${filters.country}`);
  if (filters.year) conditions.push(sql`m.release_year=${Number(filters.year)}`);
  const where = sql.join(conditions, sql` AND `);
  const order =
    filters.sort === "rating"
      ? sql`m.rating DESC NULLS LAST,m.release_year DESC,m.id`
      : filters.sort === "newest"
        ? sql`m.created_at DESC,m.id`
        : sql`m.release_year DESC,m.created_at DESC,m.id`;
  const pageSize = 12;
  const [items, count] = await Promise.all([
    database().execute(
      sql`SELECT ${movieFields} FROM cinevjet.movies m WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(filters.page - 1) * pageSize}`,
    ),
    database().execute(sql`SELECT count(*)::int AS total FROM cinevjet.movies m WHERE ${where}`),
  ]);
  return {
    items: items.rows.map(mapMovie),
    total: Number(count.rows[0]?.total || 0),
    page: filters.page,
    pageSize,
  };
}
