import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { database } from "./db";
import { SHORT_BATCH_SIZE, type AdminShort, type ShortsBatch } from "@/domain/shorts";
const fields = sql`s.*,s.thumbnail_url AS stored_thumbnail_url,COALESCE(s.published_at,s.created_at)::text AS cursor_date,m.slug AS movie_slug,m.title AS movie_title,COALESCE(s.thumbnail_url,m.poster_url) AS thumbnail_url`;
export const publicShortsWhere = sql`s.is_active AND s.deleted_at IS NULL AND s.source_type<>'DEMO' AND (s.source_type<>'EMBED' OR (s.permission_status='VERIFIED' AND s.publish_status='PUBLISHED' AND s.embed_status='AVAILABLE' AND EXISTS(SELECT 1 FROM cinevjet.short_sources ss WHERE ss.id=s.source_id AND ss.authorization_status='VERIFIED')))`;
export function mapShort(row: Record<string, unknown>): AdminShort {
  return {
    id: row.id,
    movie_id: row.movie_id,
    movie_slug: row.movie_slug,
    title: row.title,
    description: row.description,
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    creator_name: row.creator_name,
    source_type: row.source_type,
    episode_id: row.episode_id,
    display_order: row.display_order,
    is_active: row.is_active,
    movie_title: row.movie_title,
    stored_thumbnail_url: row.stored_thumbnail_url,
    provider: row.provider,
    provider_video_id: row.provider_video_id,
    original_url: row.original_url,
    embed_url: row.embed_url,
    creator_url: row.creator_url,
    published_at: row.published_at ? new Date(row.published_at as string).toISOString() : null,
    source: row.source_credit || (row.source_type === "UPLOAD" ? "Video tải lên" : "Video từ URL"),
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
  } as AdminShort;
}
type Cursor = { order: number; date: string; id: string };
function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 1024) throw new Error();
    const v = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      !Number.isInteger(v.order) ||
      typeof v.id !== "string" ||
      !v.id ||
      v.id.length > 500 ||
      typeof v.date !== "string" ||
      !Number.isFinite(Date.parse(v.date))
    )
      throw new Error();
    return v;
  } catch {
    throw new RangeError("Invalid Shorts cursor");
  }
}
function after(c: Cursor, inclusive = false): SQL {
  return sql`(s.display_order > ${c.order} OR (s.display_order=${c.order} AND (COALESCE(s.published_at,s.created_at) < ${c.date}::timestamptz OR (COALESCE(s.published_at,s.created_at)=${c.date}::timestamptz AND s.id ${inclusive ? sql`>=` : sql`>`} ${c.id}))))`;
}
export async function shortsFeed(cursor?: string, selectedId?: string): Promise<ShortsBatch> {
  let where: SQL = sql`true`;
  if (cursor && cursor !== "0") where = after(decodeCursor(cursor));
  else if (selectedId) {
    const selected = await database().execute(
      sql`SELECT s.id,s.display_order,COALESCE(s.published_at,s.created_at)::text AS cursor_date FROM cinevjet.short_videos s WHERE s.id=${selectedId} AND ${publicShortsWhere}`,
    );
    const s = selected.rows[0];
    if (s)
      where = after(
        { order: Number(s.display_order), date: String(s.cursor_date), id: String(s.id) },
        true,
      );
  }
  const result = await database().execute(
    sql`SELECT ${fields} FROM cinevjet.short_videos s LEFT JOIN cinevjet.movies m ON m.id=s.movie_id WHERE ${publicShortsWhere} AND ${where} ORDER BY s.display_order ASC,COALESCE(s.published_at,s.created_at) DESC,s.id ASC LIMIT ${SHORT_BATCH_SIZE + 1}`,
  );
  const items = result.rows.slice(0, SHORT_BATCH_SIZE).map(mapShort);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      result.rows.length > SHORT_BATCH_SIZE && last
        ? Buffer.from(
            JSON.stringify({
              order: last.display_order,
              date: result.rows[SHORT_BATCH_SIZE - 1].cursor_date,
              id: last.id,
            }),
          ).toString("base64url")
        : null,
  };
}
export async function adminShortsList(cursor = 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 1_000_000)
    throw new RangeError("Invalid cursor");
  const result = await database().execute(
    sql`SELECT ${fields} FROM cinevjet.short_videos s LEFT JOIN cinevjet.movies m ON m.id=s.movie_id WHERE s.deleted_at IS NULL AND s.source_type<>'EMBED' ORDER BY s.display_order,s.created_at DESC,s.id LIMIT 26 OFFSET ${cursor}`,
  );
  return {
    items: result.rows.slice(0, 25).map(mapShort),
    nextCursor: result.rows.length > 25 ? cursor + 25 : null,
  };
}
