import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { favoriteMovies, history } from "./account";
import { mapShort, publicShortsWhere } from "./shorts";
import { ApiError } from "./http";
export async function savedShortIds(userId: string) {
  const r = await database().execute(
    sql`SELECT short_id FROM cinevjet.saved_shorts WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 1000`,
  );
  return r.rows.map((r) => String(r.short_id));
}
export async function librarySnapshot(userId: string) {
  const [recent, movies, shorts] = await Promise.all([
    history(userId),
    favoriteMovies(userId),
    database().execute(
      sql`SELECT s.*,m.slug AS movie_slug,m.title AS movie_title,COALESCE(s.thumbnail_url,m.poster_url) AS thumbnail_url FROM cinevjet.saved_shorts b JOIN cinevjet.short_videos s ON s.id=b.short_id LEFT JOIN cinevjet.movies m ON m.id=s.movie_id WHERE b.user_id=${userId} AND ${publicShortsWhere} ORDER BY b.created_at DESC,s.id LIMIT 100`,
    ),
  ]);
  return { recent, movies, shorts: shorts.rows.map(mapShort) };
}
export async function bookmarkShort(userId: string, id: string, saved: boolean) {
  if (saved) {
    const r = await database().execute(
      sql`INSERT INTO cinevjet.saved_shorts(user_id,short_id) SELECT ${userId},s.id FROM cinevjet.short_videos s WHERE s.id=${id} AND ${publicShortsWhere} ON CONFLICT DO NOTHING RETURNING short_id`,
    );
    if (
      !r.rows.length &&
      !(
        await database().execute(
          sql`SELECT 1 FROM cinevjet.saved_shorts WHERE user_id=${userId} AND short_id=${id}`,
        )
      ).rows.length
    )
      throw new ApiError(404, "Video không còn khả dụng.");
  } else
    await database().execute(
      sql`DELETE FROM cinevjet.saved_shorts WHERE user_id=${userId} AND short_id=${id}`,
    );
  return { saved };
}
export async function removeHistory(userId: string, movieId: string, episodeId: string | null) {
  await database().execute(
    sql`DELETE FROM cinevjet.watch_history WHERE user_id=${userId} AND movie_id=${movieId} AND episode_id IS NOT DISTINCT FROM ${episodeId}`,
  );
  return { removed: true };
}
