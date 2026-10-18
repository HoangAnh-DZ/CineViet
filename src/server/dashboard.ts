import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { movieInput } from "@/domain/movie-management";
export { movieInput } from "@/domain/movie-management";
export type { MovieInput } from "@/domain/movie-management";
const stamp = (v: unknown) => new Date(v as string).toISOString();
type UserSummary = {
  id: string;
  display_name: string;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  created_at: string;
};
export type AdminUser = UserSummary & {
  is_admin: boolean;
  watched: number;
  referral_code: string | null;
  parent_name: string | null;
  parent_email: string | null;
  direct_referrals: number;
  network_size: number;
};
export type AdminMovie = {
  id: string;
  title: string;
  original_title: string;
  slug: string;
  description: string;
  poster_url: string;
  backdrop_url: string;
  release_year: number;
  country: string;
  duration_minutes: number;
  rating: number | null;
  duration_seconds: number | null;
  language: string;
  license_name: string;
  license_url: string;
  license_source_url: string;
  source_page_url: string;
  attribution: string;
  poster_attribution: string;
  type: "MOVIE" | "SERIES";
  status: "DRAFT" | "PUBLISHED" | "HIDDEN";
  vip_required: boolean;
  created_at: string;
  updated_at: string;
  viewers: number;
  preview_url: string | null;
};
export type MoneyTransaction = {
  id: string;
  user_id: string;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
  kind: "DEPOSIT" | "WITHDRAWAL" | "VIP_PURCHASE";
  source_asset: "VND" | "COIN";
  coins_amount: number | null;
  coin_value_vnd: number | null;
  plan_name: string | null;
  display_name: string;
  email: string;
  bill_url: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  order_code?: number | null;
  payos_status?: string | null;
  provider_reference?: string | null;
};
const bankReceipts = sql`(SELECT amount,completed_at,created_at FROM cinevjet.deposits WHERE status='COMPLETED' UNION ALL SELECT amount,completed_at,created_at FROM cinevjet.vip_purchase_requests WHERE status='COMPLETED')`;
export async function moneyPeriods(actor: string) {
  await assertAdmin(actor);
  const r = await database().execute(
    sql`WITH periods AS (SELECT 'TODAY' AS period, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AT TIME ZONE 'Asia/Ho_Chi_Minh' AS since UNION ALL SELECT 'WEEK', ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-6) AT TIME ZONE 'Asia/Ho_Chi_Minh' UNION ALL SELECT 'MONTH', date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' UNION ALL SELECT 'ALL', '-infinity'::timestamptz), settled AS (SELECT amount AS income, 0::bigint AS outgoing, COALESCE(completed_at,created_at) AS settled_at FROM ${bankReceipts} r UNION ALL SELECT 0::bigint, amount-fee, COALESCE(completed_at,created_at) FROM cinevjet.withdrawals WHERE status='COMPLETED') SELECT p.period, COALESCE(sum(s.income),0) AS income, COALESCE(sum(s.outgoing),0) AS outgoing FROM periods p LEFT JOIN settled s ON s.settled_at>=p.since GROUP BY p.period`,
  );
  return r.rows.map((r) => ({
    period: String(r.period),
    income: Number(r.income),
    outgoing: Number(r.outgoing),
    profit: Number(r.income) - Number(r.outgoing),
  }));
}
export async function dashboardOverview(actor: string) {
  await assertAdmin(actor);
  const [metrics, chart, monthly, transactions, users, periods] = await Promise.all([
    database().execute(
      sql`SELECT (SELECT COALESCE(sum(amount),0) FROM ${bankReceipts} r) AS income,(SELECT COALESCE(sum(amount-fee),0) FROM cinevjet.withdrawals WHERE status='COMPLETED') AS outgoing,(SELECT count(*) FROM cinevjet.users) AS users,(SELECT count(*) FROM cinevjet.movies WHERE status='PUBLISHED') AS movies`,
    ),
    database().execute(
      sql`WITH days AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-29,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,interval '1 day')::date AS bucket_date),ins AS (SELECT (COALESCE(completed_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,sum(amount) amount FROM ${bankReceipts} r WHERE COALESCE(completed_at,created_at)>=now()-interval '31 days' GROUP BY 1),outs AS (SELECT (COALESCE(completed_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,sum(amount-fee) amount FROM cinevjet.withdrawals WHERE status='COMPLETED' AND COALESCE(completed_at,created_at)>=now()-interval '31 days' GROUP BY 1) SELECT to_char(d.bucket_date,'YYYY-MM-DD') AS day,COALESCE(i.amount,0) income,COALESCE(o.amount,0) outgoing FROM days d LEFT JOIN ins i ON i.bucket_date=d.bucket_date LEFT JOIN outs o ON o.bucket_date=d.bucket_date ORDER BY d.bucket_date`,
    ),
    database().execute(
      sql`WITH months AS (SELECT generate_series(date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '11 months',date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),interval '1 month')::date AS bucket_date),ins AS (SELECT date_trunc('month',COALESCE(completed_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,sum(amount) amount FROM ${bankReceipts} r WHERE COALESCE(completed_at,created_at)>=date_trunc('month',now())-interval '12 months' GROUP BY 1),outs AS (SELECT date_trunc('month',COALESCE(completed_at,created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,sum(amount-fee) amount FROM cinevjet.withdrawals WHERE status='COMPLETED' AND COALESCE(completed_at,created_at)>=date_trunc('month',now())-interval '12 months' GROUP BY 1) SELECT to_char(m.bucket_date,'YYYY-MM') AS day,COALESCE(i.amount,0) income,COALESCE(o.amount,0) outgoing FROM months m LEFT JOIN ins i ON i.bucket_date=m.bucket_date LEFT JOIN outs o ON o.bucket_date=m.bucket_date ORDER BY m.bucket_date`,
    ),
    moneyTransactions(actor),
    database().execute<UserSummary>(
      sql`SELECT id,display_name,email,status,created_at FROM cinevjet.users ORDER BY created_at DESC,id LIMIT 5`,
    ),
    moneyPeriods(actor),
  ]);
  const m = metrics.rows[0];
  return {
    moneyPeriods: periods,
    metrics: {
      income: Number(m.income),
      outgoing: Number(m.outgoing),
      profit: Number(m.income) - Number(m.outgoing),
      users: Number(m.users),
      movies: Number(m.movies),
    },
    chart: chart.rows.map((r) => ({
      day: String(r.day),
      income: Number(r.income),
      outgoing: Number(r.outgoing),
      profit: Number(r.income) - Number(r.outgoing),
    })),
    monthlyChart: monthly.rows.map((r) => ({
      day: String(r.day),
      income: Number(r.income),
      outgoing: Number(r.outgoing),
      profit: Number(r.income) - Number(r.outgoing),
    })),
    transactions: transactions.slice(0, 6),
    users: users.rows.map((r) => ({ ...r, created_at: stamp(r.created_at) })),
  };
}
export async function moneyTransactions(actor: string) {
  await assertAdmin(actor);
  const r = await database().execute<MoneyTransaction>(
    sql`SELECT t.*,u.display_name,u.email,p.order_code,p.status AS payos_status,(SELECT e.provider_reference FROM cinevjet.payment_events e WHERE e.order_id=p.id AND e.provider_reference IS NOT NULL ORDER BY e.created_at DESC LIMIT 1) AS provider_reference FROM (SELECT id,user_id,amount,0::bigint fee,status,created_at,bill_url,bank_name,bank_account_number,bank_account_name,'DEPOSIT' AS kind,'VND' AS source_asset,NULL::bigint coins_amount,NULL::bigint coin_value_vnd,NULL::text plan_name FROM cinevjet.deposits UNION ALL SELECT id,user_id,amount,fee,status,created_at,NULL::text,bank_name,bank_account_number,bank_account_name,'WITHDRAWAL',source_asset,coins_amount,coin_value_vnd,NULL::text FROM cinevjet.withdrawals UNION ALL SELECT id,user_id,amount,0::bigint,status,created_at,bill_url,bank_name,bank_account_number,bank_account_name,'VIP_PURCHASE','VND',NULL::bigint,NULL::bigint,plan_name FROM cinevjet.vip_purchase_requests) t JOIN cinevjet.users u ON u.id=t.user_id LEFT JOIN cinevjet.payos_orders p ON p.id=t.id ORDER BY t.created_at DESC,t.id LIMIT 100`,
  );
  return r.rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    fee: Number(r.fee),
    coins_amount: r.coins_amount === null ? null : Number(r.coins_amount),
    coin_value_vnd: r.coin_value_vnd === null ? null : Number(r.coin_value_vnd),
    created_at: stamp(r.created_at),
  }));
}
export type WithdrawalFilters = {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string | number;
};
export async function withdrawalTransactions(actor: string, filters: WithdrawalFilters = {}) {
  await assertAdmin(actor);
  const statuses = ["PENDING", "PROCESSING", "COMPLETED", "REJECTED", "FAILED"];
  const status = statuses.includes(filters.status || "") ? filters.status! : "";
  const q = (filters.q || "").trim().slice(0, 100);
  const day = (value = "") =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
      ? value
      : "";
  const from = day(filters.from),
    to = day(filters.to);
  const requestedPage = Math.max(1, Math.min(100000, Math.floor(Number(filters.page)) || 1));
  // Filter withdrawals before pagination: unrelated deposits cannot hide open coin requests.
  const where = sql`(${status}='' OR w.status=${status}) AND (${q}='' OR u.display_name ILIKE ${"%" + q + "%"} OR u.email ILIKE ${"%" + q + "%"} OR w.id=${q}) AND (${from}='' OR w.created_at>=NULLIF(${from},'')::date AT TIME ZONE 'Asia/Ho_Chi_Minh') AND (${to}='' OR w.created_at<(NULLIF(${to},'')::date+1) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  return database().transaction(
    async (tx) => {
      const summary = (
        await tx.execute(
          sql`SELECT count(*)::int total,count(*) FILTER(WHERE w.status IN ('PENDING','PROCESSING'))::int waiting,count(*) FILTER(WHERE w.status='COMPLETED')::int completed,COALESCE(sum(w.amount-w.fee) FILTER(WHERE w.status='COMPLETED'),0) outgoing FROM cinevjet.withdrawals w JOIN cinevjet.users u ON u.id=w.user_id WHERE ${where}`,
        )
      ).rows[0];
      const total = Number(summary.total),
        pages = Math.max(1, Math.ceil(total / 30)),
        page = Math.min(pages, requestedPage);
      const rows = await tx.execute<MoneyTransaction>(
        sql`SELECT w.id,w.user_id,w.amount,w.fee,w.status,w.created_at,w.source_asset,w.coins_amount,w.coin_value_vnd,w.bank_name,w.bank_account_number,w.bank_account_name,'WITHDRAWAL' AS kind,NULL::text AS plan_name,NULL::text AS bill_url,u.display_name,u.email FROM cinevjet.withdrawals w JOIN cinevjet.users u ON u.id=w.user_id WHERE ${where} ORDER BY w.created_at DESC,w.id DESC LIMIT 30 OFFSET ${(page - 1) * 30}`,
      );
      return {
        items: rows.rows.map((r) => ({
          ...r,
          amount: Number(r.amount),
          fee: Number(r.fee),
          coins_amount: r.coins_amount == null ? null : Number(r.coins_amount),
          coin_value_vnd: r.coin_value_vnd == null ? null : Number(r.coin_value_vnd),
          created_at: stamp(r.created_at),
        })),
        total,
        pages,
        page,
        waiting: Number(summary.waiting),
        completed: Number(summary.completed),
        outgoing: Number(summary.outgoing),
        filters: { status, q, from, to },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type WithdrawalPage = Awaited<ReturnType<typeof withdrawalTransactions>>;
export async function adminMovies(actor: string, q = "", type = "", status = "", page = 1) {
  await assertAdmin(actor);
  page = Math.max(1, Math.min(10000, Math.floor(page) || 1));
  const where = sql`m.title ILIKE ${"%" + q.slice(0, 100) + "%"} AND (${type}='' OR m.type=${type}) AND (${status}='' OR m.status=${status})`;
  const [r, count] = await Promise.all([
    database().execute<AdminMovie>(
      sql`SELECT m.*,(SELECT count(DISTINCT w.user_id)::int FROM cinevjet.watch_history w WHERE w.movie_id=m.id) AS viewers,(SELECT playback_url FROM cinevjet.video_sources v WHERE v.movie_id=m.id AND v.is_active ORDER BY (v.episode_id IS NULL) DESC,v.id LIMIT 1) AS preview_url FROM cinevjet.movies m WHERE ${where} ORDER BY m.created_at DESC,m.id LIMIT 30 OFFSET ${(page - 1) * 30}`,
    ),
    database().execute(sql`SELECT count(*)::int total FROM cinevjet.movies m WHERE ${where}`),
  ]);
  return {
    items: r.rows.map((r) => ({
      ...r,
      created_at: stamp(r.created_at),
      rating: r.rating == null ? null : Number(r.rating),
    })),
    total: Number(count.rows[0].total),
    page,
  };
}
export async function saveMovie(actor: string, input: unknown, id?: string) {
  await assertAdmin(actor);
  const d = movieInput.parse(input);
  return database().transaction(async (tx) => {
    const old = id
      ? (await tx.execute(sql`SELECT id,type FROM cinevjet.movies WHERE id=${id} FOR UPDATE`))
          .rows[0]
      : null;
    if (id && !old) throw new ApiError(404, "Phim không tồn tại.");
    if (
      d.type === "MOVIE" &&
      d.status === "PUBLISHED" &&
      !d.playback_url &&
      !(
        id &&
        (
          await tx.execute(
            sql`SELECT 1 FROM cinevjet.video_sources WHERE movie_id=${id} AND is_active LIMIT 1`,
          )
        ).rows.length
      )
    )
      throw new ApiError(400, "Thêm nguồn video trước khi phát hành; bạn có thể lưu bản nháp.");
    if (
      d.type === "SERIES" &&
      d.status === "PUBLISHED" &&
      !d.episodes?.some((e) => e.status === "PUBLISHED") &&
      !(
        id &&
        (
          await tx.execute(
            sql`SELECT 1 FROM cinevjet.episodes e JOIN cinevjet.video_sources v ON v.episode_id=e.id AND v.movie_id=e.movie_id WHERE e.movie_id=${id} AND e.status='PUBLISHED' AND v.is_active LIMIT 1`,
          )
        ).rows.length
      )
    )
      throw new ApiError(400, "Thêm tập có nguồn video trước khi phát hành phim bộ.");
    if (
      old &&
      old.type !== d.type &&
      (await tx.execute(sql`SELECT 1 FROM cinevjet.episodes WHERE movie_id=${id} LIMIT 1`)).rows
        .length
    )
      throw new ApiError(400, "Phim đã có tập; giữ nguyên loại phim.");
    if (
      (
        await tx.execute(
          sql`SELECT 1 FROM cinevjet.movies WHERE slug=${d.slug} AND id<>${id || ""}`,
        )
      ).rows.length
    )
      throw new ApiError(409, "Đường dẫn phim đã được sử dụng.");
    const key = id || randomUUID();
    if (id)
      await tx.execute(
        sql`UPDATE cinevjet.movies SET title=${d.title},original_title=${d.original_title || d.title},slug=${d.slug},description=${d.description},poster_url=${d.poster_url},backdrop_url=${d.backdrop_url},release_year=${d.release_year},country=${d.country},duration_minutes=${d.duration_minutes},rating=${d.rating},type=${d.type},status=${d.status},vip_required=${d.vip_required},updated_at=now() WHERE id=${key}`,
      );
    else
      await tx.execute(
        sql`INSERT INTO cinevjet.movies(id,title,original_title,slug,description,poster_url,backdrop_url,release_year,country,duration_minutes,rating,type,status,vip_required) VALUES(${key},${d.title},${d.original_title || d.title},${d.slug},${d.description},${d.poster_url},${d.backdrop_url},${d.release_year},${d.country},${d.duration_minutes},${d.rating},${d.type},${d.status},${d.vip_required})`,
      );
    await tx.execute(
      sql`UPDATE cinevjet.movies SET language=${d.language},duration_seconds=${d.duration_seconds ?? null},license_name=${d.license_name},license_url=${d.license_url},license_source_url=${d.license_source_url},source_page_url=${d.source_page_url},attribution=${d.attribution},poster_attribution=${d.poster_attribution} WHERE id=${key}`,
    );
    if (d.genres) {
      await tx.execute(sql`DELETE FROM cinevjet.movie_genres WHERE movie_id=${key}`);
      for (const name of new Set(d.genres)) {
        const row = (await tx.execute(sql`SELECT id FROM cinevjet.genres WHERE name=${name}`))
          .rows[0];
        const genreId = row ? String(row.id) : randomUUID();
        if (!row)
          await tx.execute(
            sql`INSERT INTO cinevjet.genres(id,name,slug) VALUES(${genreId},${name},${genreId})`,
          );
        await tx.execute(
          sql`INSERT INTO cinevjet.movie_genres(movie_id,genre_id) VALUES(${key},${genreId})`,
        );
      }
    }
    if (
      d.playback_url &&
      !(
        await tx.execute(
          sql`SELECT 1 FROM cinevjet.video_sources WHERE movie_id=${key} AND episode_id IS NULL AND is_active AND playback_url=${d.playback_url} LIMIT 1`,
        )
      ).rows.length
    ) {
      await tx.execute(
        sql`UPDATE cinevjet.video_sources SET is_active=false WHERE movie_id=${key} AND episode_id IS NULL`,
      );
      await tx.execute(
        sql`INSERT INTO cinevjet.video_sources(id,movie_id,provider,playback_url,quality,format,is_active) VALUES(${randomUUID()},${key},'ADMIN',${d.playback_url},'AUTO',${/\.webm(?:\?|$)/i.test(d.playback_url) ? "WEBM" : "MP4"},true)`,
      );
    }
    const editedIds = (d.episodes || []).flatMap((e) => (e.id ? [e.id] : []));
    if (editedIds.length) {
      const maximum = Number(
        (
          await tx.execute(
            sql`SELECT COALESCE(max(episode_number),0)::int n FROM cinevjet.episodes WHERE movie_id=${key}`,
          )
        ).rows[0].n,
      );
      if (maximum > 2147450000) throw new ApiError(400, "Số thứ tự tập vượt giới hạn.");
      // Move only the submitted IDs out of the target range, then apply the complete order atomically.
      // Stable episode IDs keep favorites/history and source ownership intact, including swaps.
      await tx.execute(
        sql`UPDATE cinevjet.episodes e SET episode_number=(${maximum + 10001}+staged.n)::int FROM (SELECT id,row_number() OVER(ORDER BY id) n FROM cinevjet.episodes WHERE movie_id=${key} AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(editedIds)}::jsonb))) staged WHERE e.id=staged.id`,
      );
    }
    for (const e of d.episodes || []) {
      const episodeId = e.id || randomUUID();
      const prior = (
        await tx.execute(
          sql`SELECT movie_id,season_number,episode_number FROM cinevjet.episodes WHERE id=${episodeId}`,
        )
      ).rows[0];
      if (prior && prior.movie_id !== key) throw new ApiError(400, "Tập không thuộc phim này.");
      await tx.execute(
        sql`INSERT INTO cinevjet.seasons(id,movie_id,season_number,title) VALUES(${`${key}-season-${e.season}`},${key},${e.season},${`Mùa ${e.season}`}) ON CONFLICT(movie_id,season_number) DO NOTHING`,
      );
      await tx.execute(
        sql`INSERT INTO cinevjet.episodes(id,movie_id,season_number,episode_number,title,description,duration_seconds,thumbnail_url,release_date,status) VALUES(${episodeId},${key},${e.season},${e.episode_number},${e.title},${e.description || ""},${e.duration_seconds},${e.thumbnail_url || d.backdrop_url},${e.release_date || null},${e.status}) ON CONFLICT(id) DO UPDATE SET season_number=excluded.season_number,episode_number=excluded.episode_number,title=excluded.title,description=COALESCE(${e.description ?? null},cinevjet.episodes.description),duration_seconds=excluded.duration_seconds,thumbnail_url=excluded.thumbnail_url,release_date=excluded.release_date,status=excluded.status`,
      );
      if (e.playback_url) {
        const current = (
          await tx.execute(
            sql`SELECT playback_url FROM cinevjet.video_sources WHERE movie_id=${key} AND episode_id=${episodeId} AND is_active`,
          )
        ).rows;
        if (!current.some((v) => v.playback_url === e.playback_url)) {
          await tx.execute(
            sql`UPDATE cinevjet.video_sources SET is_active=false WHERE movie_id=${key} AND episode_id=${episodeId}`,
          );
          await tx.execute(
            sql`INSERT INTO cinevjet.video_sources(id,movie_id,episode_id,provider,playback_url,quality,format) VALUES(${randomUUID()},${key},${episodeId},'ADMIN',${e.playback_url},'AUTO',${/\.webm(?:\?|$)/i.test(e.playback_url) ? "WEBM" : "MP4"})`,
          );
        }
      }
    }
    if (d.status === "PUBLISHED") {
      if (
        (
          await tx.execute(
            sql`SELECT 1 FROM cinevjet.video_sources WHERE movie_id=${key} AND is_active AND playback_url='/video/bunny-trailer.mp4' LIMIT 1`,
          )
        ).rows.length
      )
        throw new ApiError(
          400,
          "Thay nguồn video demo bằng phim được cấp phép trước khi phát hành.",
        );
      await tx.execute(sql`UPDATE cinevjet.movies SET is_demo=false WHERE id=${key}`);
    }
    return { id: key };
  });
}
export async function movieEditorData(actor: string, id: string) {
  await assertAdmin(actor);
  if (!(await database().execute(sql`SELECT 1 FROM cinevjet.movies WHERE id=${id}`)).rows.length)
    throw new ApiError(404, "Phim không tồn tại.");
  const [genres, episodes] = await Promise.all([
    database().execute(
      sql`SELECT g.name FROM cinevjet.genres g JOIN cinevjet.movie_genres mg ON mg.genre_id=g.id WHERE mg.movie_id=${id} ORDER BY g.name`,
    ),
    database().execute(
      sql`SELECT e.id,e.season_number AS season,e.episode_number,e.title,e.description,e.duration_seconds,e.thumbnail_url,to_char(e.release_date,'YYYY-MM-DD') AS release_date,e.status,COALESCE((SELECT playback_url FROM cinevjet.video_sources v WHERE v.episode_id=e.id AND v.movie_id=e.movie_id AND v.is_active ORDER BY v.id LIMIT 1),'') AS playback_url FROM cinevjet.episodes e WHERE e.movie_id=${id} ORDER BY e.season_number,e.episode_number`,
    ),
  ]);
  return {
    genres: genres.rows.map((r) => String(r.name)),
    episodes: episodes.rows.map((e) => ({ ...e, release_date: e.release_date || undefined })),
  };
}
export async function hideMovie(actor: string, id: string) {
  await assertAdmin(actor);
  const r = await database().execute(
    sql`UPDATE cinevjet.movies SET status='HIDDEN',updated_at=now() WHERE id=${id} RETURNING id`,
  );
  if (!r.rows.length) throw new ApiError(404, "Phim không tồn tại.");
  return { hidden: true };
}
export async function adminUsers(actor: string, q = "") {
  await assertAdmin(actor);
  const r = await database().execute<AdminUser>(
    sql`WITH RECURSIVE referral_tree AS (
      SELECT id, id AS root_id FROM cinevjet.users
      UNION ALL
      SELECT child.id, tree.root_id FROM cinevjet.users child JOIN referral_tree tree ON child.referred_by=tree.id
    ), network AS (
      SELECT root_id, (count(*) - 1)::int AS network_size FROM referral_tree GROUP BY root_id
    )
    SELECT u.id,u.display_name,u.email,u.status,u.created_at,u.referral_code,
      parent.display_name AS parent_name,parent.email AS parent_email,
      (SELECT count(*)::int FROM cinevjet.users child WHERE child.referred_by=u.id) AS direct_referrals,
      COALESCE(network.network_size,0) AS network_size,
      EXISTS(SELECT 1 FROM cinevjet.admin_users a WHERE a.user_id=u.id) AS is_admin,
      (SELECT count(*)::int FROM cinevjet.watch_history w WHERE w.user_id=u.id) AS watched
    FROM cinevjet.users u LEFT JOIN cinevjet.users parent ON parent.id=u.referred_by LEFT JOIN network ON network.root_id=u.id
    WHERE u.email ILIKE ${"%" + q.slice(0, 100) + "%"} OR u.display_name ILIKE ${"%" + q.slice(0, 100) + "%"}
    ORDER BY u.created_at DESC,u.id LIMIT 100`,
  );
  return r.rows.map((r) => ({ ...r, created_at: stamp(r.created_at) }));
}
export async function setUserStatus(actor: string, id: string, status: "ACTIVE" | "SUSPENDED") {
  await assertAdmin(actor);
  if (id === actor) throw new ApiError(400, "Không thể khóa tài khoản đang sử dụng.");
  return database().transaction(async (tx) => {
    if ((await tx.execute(sql`SELECT 1 FROM cinevjet.admin_users WHERE user_id=${id}`)).rows.length)
      throw new ApiError(400, "Không thay đổi quyền truy cập tài khoản quản trị tại đây.");
    const r = await tx.execute(
      sql`UPDATE cinevjet.users SET status=${status},updated_at=now() WHERE id=${id} RETURNING id`,
    );
    if (!r.rows.length) throw new ApiError(404, "Người dùng không tồn tại.");
    if (status === "SUSPENDED")
      await tx.execute(sql`DELETE FROM cinevjet.sessions WHERE user_id=${id}`);
    return { status };
  });
}
export async function adminRewards(actor: string) {
  await assertAdmin(actor);
  const [r, plans] = await Promise.all([
    database().execute(
      sql`SELECT (SELECT COALESCE(sum(balance),0) FROM cinevjet.coin_wallets) balance,(SELECT COALESCE(sum(amount),0) FROM cinevjet.coin_ledger WHERE amount>0) issued,(SELECT count(*) FROM cinevjet.daily_checkins) checkins,(SELECT count(*) FROM cinevjet.vip_subscriptions WHERE status='ACTIVE' AND expires_at>now()) memberships`,
    ),
    database().execute(
      sql`SELECT id,name,price,duration_days,checkin_rewards,reward_tier,active,purchase_enabled,mission_count,mission_reward,additional_amount FROM cinevjet.vip_plans WHERE reward_tier IS NOT NULL ORDER BY price,id`,
    ),
  ]);
  const m = r.rows[0];
  return {
    balance: Number(m.balance),
    issued: Number(m.issued),
    checkins: Number(m.checkins),
    memberships: Number(m.memberships),
    plans: plans.rows.map((p) => ({ ...p, price: Number(p.price) })),
  };
}
export type DashboardData = Awaited<ReturnType<typeof dashboardOverview>>;
