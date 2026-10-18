import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { shortInput } from "@/domain/short-validation";
export async function saveShort(userId: string, input: unknown, id?: string) {
  await assertAdmin(userId);
  const data = shortInput.parse(input);
  return database().transaction(async (tx) => {
    const old = id
      ? (
          await tx.execute(
            sql`SELECT * FROM cinevjet.short_videos WHERE id=${id} AND deleted_at IS NULL FOR UPDATE`,
          )
        ).rows[0]
      : undefined;
    if (id && !old) throw new ApiError(404, "Video không còn tồn tại.");
    if (old?.source_type === "EMBED")
      throw new ApiError(400, "Dùng quản lý URL nhúng để sửa video này.");
    if (
      data.source_type === "DEMO" &&
      (!old || old.source_type !== "DEMO" || old.video_url !== data.video_url)
    )
      throw new ApiError(400, "Nguồn demo chỉ dùng cho clip mẫu đã nhập.");
    if (
      data.movie_id &&
      !(await tx.execute(sql`SELECT 1 FROM cinevjet.movies WHERE id=${data.movie_id}`)).rows.length
    )
      throw new ApiError(400, "Phim không tồn tại.");
    if (
      data.episode_id &&
      !(
        await tx.execute(
          sql`SELECT 1 FROM cinevjet.episodes WHERE id=${data.episode_id} AND movie_id=${data.movie_id}`,
        )
      ).rows.length
    )
      throw new ApiError(400, "Tập không thuộc phim đã chọn.");
    for (const [kind, url] of [
      ["video", data.video_url],
      ["thumbnail", data.thumbnail_url],
    ] as const) {
      if (!url) continue;
      const oldUrl = kind === "video" ? old?.video_url : old?.thumbnail_url;
      const ownedBlob = /\.public\.blob\.vercel-storage\.com\//i.test(url);
      if ((ownedBlob || (kind === "video" && data.source_type === "UPLOAD")) && oldUrl !== url) {
        const verified = await tx.execute(
          sql`SELECT 1 FROM cinevjet.short_uploads WHERE url=${url} AND kind=${kind}`,
        );
        if (!verified.rows.length)
          throw new ApiError(400, "File chưa được upload và xác thực. Hãy dùng nút tải file.");
      }
    }
    const key = id || randomUUID();
    const credit =
      old?.video_url === data.video_url && data.source_type === "DEMO" ? old.source_credit : null;
    if (id)
      await tx.execute(
        sql`UPDATE cinevjet.short_videos SET title=${data.title},description=${data.description},creator_name=${data.creator_name},movie_id=${data.movie_id},episode_id=${data.episode_id},video_url=${data.video_url},thumbnail_url=${data.thumbnail_url},duration_seconds=${data.duration_seconds},hashtags=${JSON.stringify(data.hashtags)}::jsonb,display_order=${data.display_order},is_active=${data.is_active},source_type=${data.source_type},source_credit=${credit},updated_at=now() WHERE id=${key}`,
      );
    else
      await tx.execute(
        sql`INSERT INTO cinevjet.short_videos(id,title,description,creator_name,movie_id,episode_id,video_url,thumbnail_url,duration_seconds,hashtags,display_order,is_active,source_type) VALUES(${key},${data.title},${data.description},${data.creator_name},${data.movie_id},${data.episode_id},${data.video_url},${data.thumbnail_url},${data.duration_seconds},${JSON.stringify(data.hashtags)}::jsonb,${data.display_order},${data.is_active},${data.source_type})`,
      );
    return { id: key };
  });
}
export async function setShortActive(userId: string, id: string, active: boolean) {
  await assertAdmin(userId);
  const r = await database().execute(
    sql`UPDATE cinevjet.short_videos SET is_active=${active},updated_at=now() WHERE id=${id} AND deleted_at IS NULL RETURNING id`,
  );
  if (!r.rows.length) throw new ApiError(404, "Video không còn tồn tại.");
  return { id };
}
export async function deleteShort(userId: string, id: string) {
  await assertAdmin(userId);
  // Archive keeps all references and media intact; external URLs are never deleted.
  const r = await database().execute(
    sql`UPDATE cinevjet.short_videos SET is_active=false,deleted_at=now(),updated_at=now() WHERE id=${id} AND deleted_at IS NULL RETURNING id`,
  );
  if (!r.rows.length) throw new ApiError(404, "Video không còn tồn tại.");
  return { id };
}
export async function shortMovieOptions(query: string, movieId?: string) {
  const [movies, episodes] = await Promise.all([
    database().execute(
      sql`SELECT id,title,poster_url FROM cinevjet.movies WHERE title ILIKE ${"%" + query.slice(0, 100) + "%"} OR id=${movieId || ""} ORDER BY title LIMIT 30`,
    ),
    movieId
      ? database().execute(
          sql`SELECT id,title,episode_number,season_number FROM cinevjet.episodes WHERE movie_id=${movieId} ORDER BY season_number,episode_number LIMIT 200`,
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return { movies: movies.rows, episodes: episodes.rows };
}
