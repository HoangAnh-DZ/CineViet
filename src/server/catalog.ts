import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { database } from "./db";
import { catalogSchema } from "./validation";
import type { Movie, Episode, VideoSource, Subtitle } from "@/domain/models";
const movieFields = sql`m.*, COALESCE((SELECT json_agg(g.name ORDER BY g.name) FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id),'[]') AS genres,
 (SELECT count(*)::int FROM cinevjet.episodes e WHERE e.movie_id=m.id AND e.status='PUBLISHED') AS episode_count`;
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
    rating: Number(row.rating),
    type: row.type as Movie["type"],
    status: row.status as Movie["status"],
    vip_required: Boolean(row.vip_required),
    genres: row.genres as string[],
    episode_count: row.episode_count == null ? undefined : Number(row.episode_count),
  };
}
async function list(where: SQL, order: SQL, limit: number) {
  const result = await database().execute(
    sql`SELECT ${movieFields} FROM cinevjet.movies m WHERE m.status='PUBLISHED' AND ${where} ORDER BY ${order} LIMIT ${limit}`,
  );
  return result.rows.map(mapMovie);
}
export async function homeCatalog() {
  const [featured, trending, newest, series, recommended] = await Promise.all([
    list(sql`true`, sql`m.rating DESC,m.id`, 3),
    list(sql`true`, sql`m.rating DESC,m.id`, 6),
    list(sql`true`, sql`m.release_year DESC,m.created_at DESC,m.id`, 6),
    list(sql`m.type='SERIES'`, sql`m.rating DESC,m.id`, 6),
    list(sql`m.vip_required=false`, sql`m.release_year DESC,m.rating DESC,m.id`, 6),
  ]);
  return { featured, trending, newest, series, recommended };
}
export async function findMovie(id: string) {
  const result = await database().execute(
    sql`SELECT ${movieFields} FROM cinevjet.movies m WHERE (m.id=${id} OR m.slug=${id}) AND m.status='PUBLISHED' LIMIT 1`,
  );
  return result.rows[0] ? mapMovie(result.rows[0]) : null;
}
export async function movieEpisodes(id: string): Promise<Episode[]> {
  const result = await database().execute(
    sql`SELECT * FROM cinevjet.episodes WHERE movie_id=${id} AND status='PUBLISHED' ORDER BY season_number,episode_number`,
  );
  return result.rows.map((r) => ({
    id: String(r.id),
    movie_id: String(r.movie_id),
    season: Number(r.season_number),
    episode_number: Number(r.episode_number),
    title: String(r.title),
    duration: Number(r.duration_seconds),
    thumbnail: String(r.thumbnail_url),
    release_date: r.release_date ? String(r.release_date) : "",
  }));
}
export async function relatedMovies(id: string) {
  return list(
    sql`m.id<>${id} AND EXISTS(SELECT 1 FROM cinevjet.movie_genres a JOIN cinevjet.movie_genres b ON a.genre_id=b.genre_id WHERE a.movie_id=m.id AND b.movie_id=${id})`,
    sql`m.rating DESC,m.id`,
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
      mime_type: r.format === "MP4" ? "video/mp4" : "application/vnd.apple.mpegurl",
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
  const [genres, countries, years] = await Promise.all([
    database().execute(sql`SELECT name FROM cinevjet.genres ORDER BY name`),
    database().execute(
      sql`SELECT DISTINCT country FROM cinevjet.movies WHERE status='PUBLISHED' ORDER BY country`,
    ),
    database().execute(
      sql`SELECT DISTINCT release_year FROM cinevjet.movies WHERE status='PUBLISHED' ORDER BY release_year DESC`,
    ),
  ]);
  return {
    genres: ["Tất cả", "Phim lẻ", "Phim bộ", ...genres.rows.map((r) => String(r.name))],
    countries: countries.rows.map((r) => String(r.country)),
    years: years.rows.map((r) => Number(r.release_year)),
  };
}
export async function searchCatalog(input: unknown) {
  const filters = catalogSchema.parse(input);
  const conditions: SQL[] = [sql`m.status='PUBLISHED'`];
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
      ? sql`m.rating DESC,m.id`
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
