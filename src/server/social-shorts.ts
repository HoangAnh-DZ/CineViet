import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { verifySocialEmbed, type EmbedCheck } from "./social-short-providers";
import {
  parseSocialVideo,
  parseSocialSource,
  socialSourceInput,
  socialImportInput,
  socialReviewInput,
  MAX_NEW_VIDEOS_PER_DAY,
} from "@/domain/social-shorts";
type Row = Record<string, unknown>;
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);
export async function socialShortsAdmin(actor: string, page = 1) {
  await assertAdmin(actor);
  page = Math.max(1, Math.min(10000, Math.floor(page) || 1));
  const [sources, items, stats, runs, control] = await Promise.all([
    database().execute(sql`SELECT * FROM cinevjet.short_sources ORDER BY created_at,id LIMIT 10`),
    database().execute(
      sql`SELECT v.*,s.authorization_status,s.sync_enabled FROM cinevjet.short_videos v JOIN cinevjet.short_sources s ON s.id=v.source_id WHERE v.source_type='EMBED' AND v.deleted_at IS NULL ORDER BY v.created_at DESC,v.id LIMIT 25 OFFSET ${(page - 1) * 25}`,
    ),
    database().execute(
      sql`SELECT count(*)::int total,count(*) FILTER(WHERE publish_status='PUBLISHED' AND embed_status='AVAILABLE' AND is_active AND permission_status='VERIFIED' AND EXISTS(SELECT 1 FROM cinevjet.short_sources s WHERE s.id=source_id AND s.authorization_status='VERIFIED'))::int published,count(*) FILTER(WHERE publish_status IN ('PENDING','QUEUED'))::int pending,(SELECT count(*)::int FROM cinevjet.short_publications WHERE calendar_date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) today FROM cinevjet.short_videos WHERE source_type='EMBED' AND deleted_at IS NULL`,
    ),
    database().execute(
      sql`SELECT * FROM cinevjet.short_sync_runs ORDER BY started_at DESC,id DESC LIMIT 5`,
    ),
    database().execute(
      sql`SELECT enabled,daily_target,starts_at,ends_at FROM cinevjet.short_sync_control WHERE id='default'`,
    ),
  ]);
  return {
    sources: sources.rows,
    items: items.rows,
    stats: stats.rows[0],
    runs: runs.rows,
    control: control.rows[0],
    page,
    mode: "MANUAL_SOURCE_AUTOMATED_PROCESSING" as const,
  };
}
export type SocialAdminData = Awaited<ReturnType<typeof socialShortsAdmin>>;
export async function saveSocialSource(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = socialSourceInput.parse(input);
  let sourceUrl: string;
  try {
    sourceUrl = parseSocialSource(d.source_url, d.provider);
  } catch {
    throw new ApiError(400, "URL tác giả không hợp lệ hoặc sai nền tảng.");
  }
  return database().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM cinevjet.short_sync_control WHERE id='default' FOR UPDATE`);
    const old = d.id
      ? (await tx.execute(sql`SELECT * FROM cinevjet.short_sources WHERE id=${d.id} FOR UPDATE`))
          .rows[0]
      : null;
    if (d.id && !old) throw new ApiError(404, "Nguồn không tồn tại.");
    if (old && (old.provider !== d.provider || old.source_url !== sourceUrl))
      throw new ApiError(400, "Tạo nguồn mới nếu đổi tác giả hoặc nền tảng.");
    if (!old) {
      const duplicate = (
        await tx.execute(
          sql`SELECT id FROM cinevjet.short_sources WHERE provider=${d.provider} AND source_url=${sourceUrl}`,
        )
      ).rows[0];
      if (duplicate) return { id: String(duplicate.id) };
    }
    if (
      !old &&
      Number(
        (await tx.execute(sql`SELECT count(*)::int n FROM cinevjet.short_sources`)).rows[0].n,
      ) >= 10
    )
      throw new ApiError(400, "MVP tối đa 10 nguồn.");
    const id = d.id || randomUUID();
    if (old)
      await tx.execute(
        sql`UPDATE cinevjet.short_sources SET creator_name=${d.creator_name},authorization_status=${d.authorization_status},permission_evidence=${d.permission_evidence},sync_enabled=${d.sync_enabled},reviewed_by=${actor},updated_at=now() WHERE id=${id}`,
      );
    else
      await tx.execute(
        sql`INSERT INTO cinevjet.short_sources(id,provider,source_url,creator_name,authorization_status,permission_evidence,sync_enabled,reviewed_by) VALUES(${id},${d.provider},${sourceUrl},${d.creator_name},${d.authorization_status},${d.permission_evidence},${d.sync_enabled},${actor}) ON CONFLICT(provider,source_url) DO NOTHING`,
      );
    return { id };
  });
}
export async function importSocialUrls(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = socialImportInput.parse(input);
  let videos: ReturnType<typeof parseSocialVideo>[];
  try {
    videos = d.urls.map(parseSocialVideo);
  } catch (e) {
    throw new ApiError(400, e instanceof Error ? e.message : "URL không hợp lệ.");
  }
  return database().transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM cinevjet.short_sync_control WHERE id='default' FOR UPDATE`);
    const source = (
      await tx.execute(sql`SELECT * FROM cinevjet.short_sources WHERE id=${d.source_id} FOR UPDATE`)
    ).rows[0];
    if (!source) throw new ApiError(404, "Chọn nguồn trước khi nhập URL.");
    if (
      videos.some(
        (v) =>
          v.provider !== source.provider ||
          (v.creatorUrl && v.creatorUrl.toLowerCase() !== source.source_url),
      )
    )
      throw new ApiError(400, "URL không thuộc tác giả hoặc nền tảng đã chọn.");
    const waiting = Number(
      (
        await tx.execute(
          sql`SELECT count(*)::int n FROM cinevjet.short_videos WHERE source_type='EMBED' AND publish_status IN ('PENDING','QUEUED') AND deleted_at IS NULL`,
        )
      ).rows[0].n,
    );
    if (waiting + videos.length > 180)
      throw new ApiError(400, "Hàng chờ tối đa 180 URL. Xử lý nội dung cũ trước khi nhập tiếp.");
    let added = 0;
    for (const v of videos) {
      const r = await tx.execute(
        sql`INSERT INTO cinevjet.short_videos(id,title,creator_name,creator_url,video_url,source_type,source_credit,display_order,is_active,provider,provider_video_id,original_url,embed_url,source_id) VALUES(${randomUUID()},${v.originalUrl.slice(0, 160)},${String(source.creator_name)},${String(source.source_url)},${v.originalUrl},'EMBED',${v.provider === "TIKTOK" ? "TikTok" : "Facebook"},-1000000,false,${v.provider},${v.providerVideoId},${v.originalUrl},${v.embedUrl},${d.source_id}) ON CONFLICT(provider,provider_video_id) WHERE provider IS NOT NULL DO NOTHING RETURNING id`,
      );
      added += r.rows.length;
    }
    return { added, duplicates: videos.length - added };
  });
}
async function persistCheck(id: string, result: EmbedCheck) {
  await database().execute(
    sql`UPDATE cinevjet.short_videos SET embed_status=${result.status},last_checked_at=now(),next_check_at=now()+${result.error === "RATE_LIMITED" ? sql`interval '1 day'` : result.error ? sql`interval '6 hours'` : sql`interval '7 days'`},last_error=${result.error},title=COALESCE(${result.title ?? null},title),creator_name=COALESCE(${result.creator_name ?? null},creator_name),creator_url=COALESCE(${result.creator_url ?? null},creator_url),thumbnail_url=COALESCE(${result.thumbnail_url ?? null},thumbnail_url),publish_status=CASE WHEN ${result.status}='UNAVAILABLE' OR (${result.status}='NEEDS_REVIEW' AND publish_status='PUBLISHED') THEN 'UNAVAILABLE' ELSE publish_status END,is_active=CASE WHEN ${result.status}<>'AVAILABLE' THEN false ELSE is_active END,updated_at=now() WHERE id=${id} AND source_type='EMBED'`,
  );
  await database().execute(
    sql`UPDATE cinevjet.short_sources SET last_synced_at=now(),last_error=${result.error} WHERE id=(SELECT source_id FROM cinevjet.short_videos WHERE id=${id})`,
  );
}
export async function checkSocialShort(actor: string, id: string) {
  await assertAdmin(actor);
  z.string().uuid().parse(id);
  // Lock a short-lived check lease in PostgreSQL to bound admin retries as well as Cron work.
  const row = (
    await database().execute(
      sql`UPDATE cinevjet.short_videos v SET last_checked_at=now(),next_check_at=now()+interval '2 minutes' WHERE id=${id} AND source_type='EMBED' AND deleted_at IS NULL AND (last_checked_at IS NULL OR next_check_at<=now()) AND NOT EXISTS(SELECT 1 FROM cinevjet.short_sources s WHERE s.provider=v.provider AND s.last_error='RATE_LIMITED' AND s.last_synced_at>now()-interval '1 day') RETURNING v.*`,
    )
  ).rows[0];
  if (!row) throw new ApiError(429, "Video vừa được kiểm tra. Thử lại sau thời gian chờ.");
  const result = await verifySocialEmbed(row);
  await persistCheck(id, result);
  return result;
}
export async function reviewSocialShort(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = socialReviewInput.parse(input);
  return database().transaction(async (tx) => {
    const row = (
      await tx.execute(
        sql`SELECT v.*,s.authorization_status,s.sync_enabled FROM cinevjet.short_videos v JOIN cinevjet.short_sources s ON s.id=v.source_id WHERE v.id=${d.id} AND v.source_type='EMBED' AND v.deleted_at IS NULL FOR UPDATE OF v,s`,
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Video không tồn tại.");
    if (d.decision !== "APPROVE") {
      await tx.execute(
        sql`UPDATE cinevjet.short_videos SET is_active=false,publish_status=${d.decision === "HIDE" ? "HIDDEN" : "REJECTED"},permission_status=CASE WHEN ${d.decision}='REJECT' THEN 'REJECTED' ELSE permission_status END,reviewed_by=${actor},updated_at=now() WHERE id=${d.id}`,
      );
      return { queued: false };
    }
    if (
      !d.confirm_rights ||
      d.permission_evidence.length < 12 ||
      row.authorization_status !== "VERIFIED" ||
      !row.sync_enabled
    )
      throw new ApiError(400, "Cần nguồn đã được duyệt, đang bật và căn cứ quyền sử dụng phù hợp.");
    const title = d.title || String(row.title);
    if (title === row.original_url || !title.trim())
      throw new ApiError(400, "Kiểm tra metadata và nhập tiêu đề thật.");
    if (
      row.provider === "TIKTOK" &&
      (row.embed_status !== "AVAILABLE" ||
        !row.last_checked_at ||
        new Date(String(row.last_checked_at)).getTime() < Date.now() - 7 * 86400000)
    )
      throw new ApiError(400, "Kiểm tra metadata TikTok trước khi duyệt.");
    if (row.provider === "FACEBOOK" && !d.embed_confirmed)
      throw new ApiError(
        400,
        "Xem preview Facebook và xác nhận video công khai phát được trong trình nhúng.",
      );
    await tx.execute(
      sql`UPDATE cinevjet.short_videos SET title=${title},creator_name=COALESCE(${d.creator_name ?? null},creator_name),permission_status='VERIFIED',permission_evidence=${d.permission_evidence},embed_status='AVAILABLE',embed_confirmed_at=CASE WHEN provider='FACEBOOK' THEN now() ELSE embed_confirmed_at END,reviewed_by=${actor},publish_status=CASE WHEN publish_status='PUBLISHED' THEN 'PUBLISHED' ELSE 'QUEUED' END,next_check_at=now(),updated_at=now() WHERE id=${d.id}`,
    );
    return { queued: true };
  });
}
export async function configureSocialSync(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = z
    .object({
      enabled: z.boolean(),
      daily_target: z.number().int().min(1).max(MAX_NEW_VIDEOS_PER_DAY),
    })
    .strict()
    .parse(input);
  await database().execute(
    sql`UPDATE cinevjet.short_sync_control SET enabled=${d.enabled},daily_target=${d.daily_target} WHERE id='default'`,
  );
  return d;
}

export async function runSocialSync(trigger: "CRON" | "ADMIN", actor?: string) {
  if (trigger === "ADMIN") {
    if (!actor) throw new ApiError(403, "Cần quyền quản trị.");
    await assertAdmin(actor);
  }
  const token = randomUUID(),
    runId = randomUUID();
  const lease = await database().transaction(async (tx) => {
    const c = (
      await tx.execute(
        sql`SELECT *,now() db_now,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day FROM cinevjet.short_sync_control WHERE id='default' FOR UPDATE`,
      )
    ).rows[0];
    if (!c.enabled) return { status: "PAUSED" as const };
    if (iso(c.ends_at)! <= iso(c.db_now)!) return { status: "EXPIRED" as const };
    if (c.leased_until && iso(c.leased_until)! > iso(c.db_now)!) return { status: "BUSY" as const };
    const day = (
      await tx.execute(
        sql`SELECT videos_added FROM cinevjet.short_sync_days WHERE calendar_date=${String(c.day)}::date`,
      )
    ).rows[0];
    const remaining = MAX_NEW_VIDEOS_PER_DAY - Number(day?.videos_added || 0);
    if (remaining <= 0) return { status: "DAILY_LIMIT" as const };
    await tx.execute(
      sql`UPDATE cinevjet.short_sync_runs SET status='INTERRUPTED',finished_at=now(),error_summary='LEASE_EXPIRED' WHERE status='RUNNING' AND started_at<now()-interval '2 minutes'`,
    );
    await tx.execute(
      sql`UPDATE cinevjet.short_sync_control SET lease_token=${token},leased_until=now()+interval '90 seconds' WHERE id='default'`,
    );
    await tx.execute(
      sql`INSERT INTO cinevjet.short_sync_runs(id,trigger_type) VALUES(${runId},${trigger})`,
    );
    return {
      status: "RUNNING" as const,
      day: String(c.day),
      target: Math.min(remaining, Number(c.daily_target)),
    };
  });
  if (lease.status !== "RUNNING") return { status: lease.status, added: 0, checked: 0, skipped: 0 };
  let checked = 0,
    added = 0,
    skipped = 0,
    error: string | null = null,
    status = "EMPTY";
  const deadline = Date.now() + 45000;
  try {
    const candidates = (
      await database().execute(
        sql`SELECT v.* FROM cinevjet.short_videos v JOIN cinevjet.short_sources s ON s.id=v.source_id WHERE v.source_type='EMBED' AND v.deleted_at IS NULL AND v.publish_status='QUEUED' AND v.permission_status='VERIFIED' AND s.authorization_status='VERIFIED' AND s.sync_enabled AND v.next_check_at<=now() AND NOT EXISTS(SELECT 1 FROM cinevjet.short_sources limited WHERE limited.provider=v.provider AND limited.last_error='RATE_LIMITED' AND limited.last_synced_at>now()-interval '1 day') ORDER BY CASE WHEN v.provider='TIKTOK' THEN 0 ELSE 1 END,v.created_at,v.id LIMIT 8`,
      )
    ).rows;
    const sourceIds = new Set<string>();
    for (const row of candidates) {
      if (added >= lease.target || Date.now() > deadline) break;
      if (!sourceIds.has(String(row.source_id)) && sourceIds.size >= 3) {
        skipped++;
        continue;
      }
      sourceIds.add(String(row.source_id));
      checked++;
      const result = await verifySocialEmbed(row);
      await persistCheck(String(row.id), result);
      if (result.status !== "AVAILABLE") {
        skipped++;
        error = result.error;
        if (result.error === "RATE_LIMITED") {
          status = "RATE_LIMITED";
          break;
        }
        continue;
      }
      const published = await database().transaction(async (tx) => {
        const control = (
          await tx.execute(
            sql`SELECT *,now() db_now,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day FROM cinevjet.short_sync_control WHERE id='default' FOR UPDATE`,
          )
        ).rows[0];
        if (
          control.lease_token !== token ||
          !control.enabled ||
          iso(control.ends_at)! <= iso(control.db_now)! ||
          iso(control.leased_until)! <= iso(control.db_now)!
        )
          return false;
        const current = (
          await tx.execute(
            sql`SELECT v.*,s.authorization_status,s.sync_enabled FROM cinevjet.short_videos v JOIN cinevjet.short_sources s ON s.id=v.source_id WHERE v.id=${String(row.id)} FOR UPDATE OF v,s`,
          )
        ).rows[0];
        if (
          current.publish_status !== "QUEUED" ||
          current.permission_status !== "VERIFIED" ||
          current.authorization_status !== "VERIFIED" ||
          !current.sync_enabled ||
          current.deleted_at ||
          current.embed_status !== "AVAILABLE"
        )
          return false;
        await tx.execute(
          sql`INSERT INTO cinevjet.short_sync_days(calendar_date) VALUES(${String(control.day)}::date) ON CONFLICT DO NOTHING`,
        );
        const old = (
          await tx.execute(
            sql`SELECT short_id FROM cinevjet.short_publications WHERE short_id=${String(row.id)}`,
          )
        ).rows[0];
        if (!old) {
          const quota = await tx.execute(
            sql`UPDATE cinevjet.short_sync_days SET videos_added=videos_added+1 WHERE calendar_date=${String(control.day)}::date AND videos_added<${MAX_NEW_VIDEOS_PER_DAY} RETURNING videos_added`,
          );
          if (!quota.rows.length) return false;
          await tx.execute(
            sql`INSERT INTO cinevjet.short_publications(short_id,calendar_date) VALUES(${String(row.id)},${String(control.day)}::date)`,
          );
        }
        await tx.execute(
          sql`UPDATE cinevjet.short_videos SET publish_status='PUBLISHED',is_active=true,published_at=COALESCE(published_at,now()),updated_at=now() WHERE id=${String(row.id)}`,
        );
        return !old;
      });
      if (published) {
        added++;
        status = "COMPLETED";
      } else skipped++;
    }
    // Small rotating health check, never a scan of the whole catalog.
    if (error !== "RATE_LIMITED" && Date.now() < deadline) {
      const old = (
        await database().execute(
          sql`SELECT v.* FROM cinevjet.short_videos v JOIN cinevjet.short_sources s ON s.id=v.source_id WHERE v.source_type='EMBED' AND v.publish_status='PUBLISHED' AND v.deleted_at IS NULL AND v.next_check_at<=now() AND s.authorization_status='VERIFIED' AND s.sync_enabled AND NOT EXISTS(SELECT 1 FROM cinevjet.short_sources limited WHERE limited.provider=v.provider AND limited.last_error='RATE_LIMITED' AND limited.last_synced_at>now()-interval '1 day') ORDER BY v.next_check_at,v.id LIMIT 2`,
        )
      ).rows;
      for (const row of old) {
        if (Date.now() > deadline) break;
        if (!sourceIds.has(String(row.source_id)) && sourceIds.size >= 3) continue;
        sourceIds.add(String(row.source_id));
        const result = await verifySocialEmbed(row);
        checked++;
        await persistCheck(String(row.id), result);
        if (result.error === "RATE_LIMITED") {
          error = result.error;
          status = "RATE_LIMITED";
          break;
        }
      }
    }
    if (error && status === "EMPTY") status = "PARTIAL";
  } catch {
    status = "FAILED";
    error = "SYNC_FAILED";
  } finally {
    await database().transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE cinevjet.short_sync_runs SET status=${status},finished_at=now(),candidates_checked=${checked},videos_added=${added},videos_skipped=${skipped},error_summary=${error} WHERE id=${runId}`,
      );
      await tx.execute(
        sql`UPDATE cinevjet.short_sync_control SET lease_token=NULL,leased_until=NULL WHERE id='default' AND lease_token=${token}`,
      );
    });
  }
  return { id: runId, status, checked, added, skipped, error };
}
