import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { parseSocialVideo, parseSocialSource } from "../src/domain/social-shorts";
import {
  saveSocialSource,
  importSocialUrls,
  checkSocialShort,
  reviewSocialShort,
  configureSocialSync,
  runSocialSync,
  socialShortsAdmin,
} from "../src/server/social-shorts";
import { verifySocialEmbed } from "../src/server/social-short-providers";
import { shortsFeed } from "../src/server/shorts";
import { bookmarkShort, librarySnapshot } from "../src/server/library";
import { saveShort } from "../src/server/admin-shorts";
import { authorizedCron } from "../src/server/cron-auth";
const pg = new PGlite();
for (const name of (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort())
  await pg.exec(await readFile(`database/migrations/${name}`, "utf8"));
await pg.exec(await readFile("database/seed.sql", "utf8"));
await pg.exec(await readFile("database/shorts-seed.sql", "utf8"));
await pg.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('social-admin','admin@example.invalid','unused','QA Admin'),('social-user','user@example.invalid','unused','QA User'); INSERT INTO cinevjet.admin_users(user_id) VALUES('social-admin');",
);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pg,
) as unknown as NodePgDatabase;
let networkCalls = 0,
  mode = "OK";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  networkCalls++;
  const u = new URL(String(input));
  assert.equal(u.origin, "https://www.tiktok.com");
  assert.equal(u.pathname, "/oembed");
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal);
  if (mode === "429") return new Response("", { status: 429 });
  if (mode === "404") return new Response("", { status: 404 });
  if (mode === "ERROR") throw Error("test network");
  if (mode === "BAD")
    return Response.json({
      type: "video",
      provider_name: "Unknown",
      title: "bad",
      html: "<script>attack()</script>",
    });
  const video = parseSocialVideo(u.searchParams.get("url")!);
  return Response.json({
    type: "video",
    provider_name: "TikTok",
    title: `QA ${video.providerVideoId}`,
    author_name: "QA Creator",
    author_url: video.creatorUrl,
    html: "<script>never execute</script>",
  });
};
const sourceBase = {
  provider: "TIKTOK" as const,
  source_url: "https://www.tiktok.com/@cinevjet_qa",
  creator_name: "QA Creator",
  authorization_status: "PENDING" as const,
  permission_evidence: "",
  sync_enabled: true,
};
const evidence = "ISOLATED FIXTURE ONLY: not a production rights claim";
const urls = Array.from(
  { length: 12 },
  (_, i) => `https://www.tiktok.com/@cinevjet_qa/video/${7000000000000000000n + BigInt(i)}`,
);
let sourceId = "",
  ids: string[] = [];
async function finance() {
  return (
    await pg.query(
      "SELECT (SELECT count(*) FROM cinevjet.coin_ledger) coins,(SELECT count(*) FROM cinevjet.wallet_ledger) cash,(SELECT count(*) FROM cinevjet.vip_subscriptions) vip,(SELECT count(*) FROM cinevjet.payos_orders) orders,(SELECT count(*) FROM cinevjet.withdrawals) withdrawals",
    )
  ).rows[0];
}
const before = await finance();
test("safe URL parsing, no redirect expansion or arbitrary host fetch", () => {
  for (const url of [
    "http://www.tiktok.com/@x/video/7000000000000000001",
    "https://www.tiktok.com.evil.test/@x/video/7000000000000000001",
    "https://www.tiktok.com@127.0.0.1/@x/video/7000000000000000001",
    "https://127.0.0.1/video/7000000000000000001",
    "javascript:alert(1)",
    "https://vm.tiktok.com/abc/",
    "https://www.facebook.com/plugins/video.php?href=https://127.0.0.1",
    "https://www.tiktok.com:444/@x/video/7000000000000000001",
  ])
    assert.throws(() => parseSocialVideo(url));
  assert.throws(() => parseSocialSource("https://127.0.0.1/creator", "FACEBOOK"));
  assert.equal(parseSocialVideo(urls[0] + "?tracking=x").originalUrl, urls[0]);
  assert.equal(parseSocialVideo("https://www.facebook.com/reel/1234567890/").provider, "FACEBOOK");
  assert.equal(
    parseSocialVideo("https://m.facebook.com/creator/videos/1234567890/").providerVideoId,
    "1234567890",
  );
});
test("admin-only manual import, deduplication and explicit rights approval", async () => {
  await assert.rejects(() => saveSocialSource("social-user", sourceBase));
  sourceId = (await saveSocialSource("social-admin", sourceBase)).id;
  assert.equal(
    (await saveSocialSource("social-admin", sourceBase)).id,
    sourceId,
    "duplicate source returns its real existing ID",
  );
  assert.equal((await importSocialUrls("social-admin", { source_id: sourceId, urls })).added, 12);
  assert.deepEqual(
    await importSocialUrls("social-admin", {
      source_id: sourceId,
      urls: [urls[0], urls[0] + "?utm=x"],
    }),
    { added: 0, duplicates: 2 },
  );
  await assert.rejects(() =>
    importSocialUrls("social-user", { source_id: sourceId, urls: [urls[0]] }),
  );
  await assert.rejects(() =>
    importSocialUrls("social-admin", { source_id: sourceId, urls: Array(31).fill(urls[0]) }),
  );
  await assert.rejects(() =>
    importSocialUrls("social-admin", {
      source_id: sourceId,
      urls: ["https://www.tiktok.com/@different/video/7000000000000000001"],
    }),
  );
  ids = (await socialShortsAdmin("social-admin")).items.map((r) => String(r.id));
  assert.equal((await shortsFeed()).items.length, 0, "unapproved embeds and old demos are absent");
  await checkSocialShort("social-admin", ids[0]);
  await assert.rejects(() =>
    reviewSocialShort("social-admin", {
      id: ids[0],
      decision: "APPROVE",
      permission_evidence: evidence,
      confirm_rights: true,
    }),
  );
  await saveSocialSource("social-admin", {
    ...sourceBase,
    id: sourceId,
    authorization_status: "VERIFIED",
    permission_evidence: evidence,
    confirm_rights: true,
  });
  for (const id of ids) {
    if (id !== ids[0]) await checkSocialShort("social-admin", id);
    await reviewSocialShort("social-admin", {
      id,
      decision: "APPROVE",
      permission_evidence: evidence,
      confirm_rights: true,
    });
  }
  assert.equal(
    (await shortsFeed()).items.length,
    0,
    "approval queues rather than directly publishes",
  );
  const pending = (await pg.query("SELECT * FROM cinevjet.short_videos WHERE id=$1", [ids[0]]))
    .rows[0];
  assert.equal(pending.video_url, pending.original_url);
  assert.equal(pending.embed_url, parseSocialVideo(String(pending.original_url)).embedUrl);
  assert.equal("html" in pending, false);
});
test("daily target, immutable quota, repeated runs, feed and bookmark synchronization", async () => {
  assert.equal((await runSocialSync("ADMIN", "social-admin")).added, 3);
  const first = await shortsFeed();
  assert.equal(first.items.length, 3);
  const publicJson = JSON.stringify(first);
  assert.ok(!publicJson.includes(evidence));
  assert.ok(!publicJson.includes("permission_evidence"));
  assert.ok(!publicJson.includes("reviewed_by"));
  await bookmarkShort("social-user", first.items[0].id, true);
  assert.equal((await librarySnapshot("social-user")).shorts.length, 1);
  const next = await runSocialSync("ADMIN", "social-admin");
  assert.equal(next.added, 2);
  const calls = networkCalls;
  assert.equal((await runSocialSync("ADMIN", "social-admin")).status, "DAILY_LIMIT");
  assert.equal(networkCalls, calls);
  const count = (
    await pg.query(
      "SELECT videos_added,calendar_date::text AS day,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text actual FROM cinevjet.short_sync_days",
    )
  ).rows[0];
  assert.equal(count.videos_added, 5);
  assert.equal(count.day, count.actual);
  await reviewSocialShort("social-admin", { id: first.items[0].id, decision: "HIDE" });
  assert.equal((await librarySnapshot("social-user")).shorts.length, 0);
  await reviewSocialShort("social-admin", {
    id: first.items[0].id,
    decision: "APPROVE",
    permission_evidence: evidence,
    confirm_rights: true,
  });
  assert.equal((await runSocialSync("ADMIN", "social-admin")).added, 0);
  assert.equal(
    (await pg.query("SELECT count(*)::int n FROM cinevjet.short_publications")).rows[0].n,
    5,
  );
  const source = (await socialShortsAdmin("social-admin")).sources[0];
  await saveSocialSource("social-admin", {
    ...sourceBase,
    id: sourceId,
    authorization_status: "REJECTED",
    permission_evidence: evidence,
  });
  assert.equal((await shortsFeed()).items.length, 0);
  await saveSocialSource("social-admin", {
    ...sourceBase,
    id: sourceId,
    authorization_status: "VERIFIED",
    permission_evidence: evidence,
    confirm_rights: true,
  });
  await assert.rejects(() => saveShort("social-admin", { title: "bypass" }, ids[0]));
});
test("published embed losing metadata is hidden safely without violating its database contract", async () => {
  const published=(await shortsFeed()).items[0];
  assert.ok(published);
  await pg.query("UPDATE cinevjet.short_videos SET next_check_at=now()-interval '1 minute' WHERE id=$1",[published.id]);
  mode='BAD';
  assert.equal((await checkSocialShort('social-admin',published.id)).status,'NEEDS_REVIEW');
  assert.ok(!(await shortsFeed()).items.some(v=>v.id===published.id));
  const row=(await pg.query("SELECT is_active,publish_status FROM cinevjet.short_videos WHERE id=$1",[published.id])).rows[0];
  assert.deepEqual(row,{is_active:false,publish_status:'UNAVAILABLE'});
  mode='OK';
});

test("provider failures, rate limit backoff, private/removed video and no false 200 success", async () => {
  const row = (await pg.query("SELECT * FROM cinevjet.short_videos WHERE id=$1", [ids[0]])).rows[0];
  mode = "BAD";
  assert.equal((await verifySocialEmbed(row)).status, "NEEDS_REVIEW");
  mode = "ERROR";
  assert.equal((await verifySocialEmbed(row)).error, "PROVIDER_ERROR");
  mode = "429";
  assert.equal((await verifySocialEmbed(row)).error, "RATE_LIMITED");
  mode = "404";
  assert.equal((await verifySocialEmbed(row)).status, "UNAVAILABLE");
  mode = "OK";
  // Reset only this disposable fixture's calendar, never production state.
  await pg.exec("UPDATE cinevjet.short_sync_days SET videos_added=0");
  mode = "429";
  const run = await runSocialSync("ADMIN", "social-admin");
  assert.equal(run.status, "RATE_LIMITED");
  assert.equal(run.added, 0);
  const backoff = (
    await pg.query(
      "SELECT next_check_at>now()+interval '23 hours' delayed FROM cinevjet.short_videos WHERE last_error='RATE_LIMITED'",
    )
  ).rows;
  assert.ok(backoff.length);
  assert.ok(backoff.every((r) => r.delayed));
  const calls = networkCalls;
  await runSocialSync("ADMIN", "social-admin");
  assert.equal(
    networkCalls,
    calls,
    "rate limiting blocks other videos on the same provider until the next day",
  );
  mode = "OK";
});
test("Facebook needs actual admin metadata and recent official-preview confirmation, no fake API", async () => {
  const source = await saveSocialSource("social-admin", {
    provider: "FACEBOOK",
    source_url: "https://www.facebook.com/qa_creator",
    creator_name: "QA Facebook",
    authorization_status: "VERIFIED",
    permission_evidence: evidence,
    sync_enabled: true,
    confirm_rights: true,
  });
  await importSocialUrls("social-admin", {
    source_id: source.id,
    urls: ["https://www.facebook.com/qa_creator/videos/1234567890/"],
  });
  const row = (await socialShortsAdmin("social-admin")).items.find(
    (r) => r.provider === "FACEBOOK",
  )!;
  const calls = networkCalls;
  assert.equal((await verifySocialEmbed(row)).status, "NEEDS_REVIEW");
  assert.equal(networkCalls, calls);
  await assert.rejects(() =>
    reviewSocialShort("social-admin", {
      id: row.id,
      decision: "APPROVE",
      title: "QA manual title",
      permission_evidence: evidence,
      confirm_rights: true,
    }),
  );
  await reviewSocialShort("social-admin", {
    id: row.id,
    decision: "APPROVE",
    title: "QA manual title",
    permission_evidence: evidence,
    confirm_rights: true,
    embed_confirmed: true,
  });
  const approved = (await pg.query("SELECT * FROM cinevjet.short_videos WHERE id=$1", [row.id]))
    .rows[0];
  assert.equal((await verifySocialEmbed(approved)).status, "AVAILABLE");
  assert.equal(
    (await verifySocialEmbed({ ...approved, embed_confirmed_at: "2000-01-01" })).status,
    "NEEDS_REVIEW",
  );
});
test("scheduler auth, pause, 30-day stop and unchanged financial data", async () => {
  delete process.env.CRON_SECRET;
  assert.equal(authorizedCron(new Request("https://example.test")), false);
  process.env.CRON_SECRET = "isolated-cron-secret-test-only";
  assert.equal(
    authorizedCron(
      new Request("https://example.test", {
        headers: { authorization: "Bearer isolated-cron-secret-test-only" },
      }),
    ),
    true,
  );
  assert.equal(
    authorizedCron(
      new Request("https://example.test", { headers: { authorization: "Bearer wrong" } }),
    ),
    false,
  );
  await assert.rejects(() =>
    configureSocialSync("social-admin", { enabled: true, daily_target: 6 }),
  );
  await configureSocialSync("social-admin", { enabled: false, daily_target: 3 });
  assert.equal((await runSocialSync("ADMIN", "social-admin")).status, "PAUSED");
  await pg.exec(
    "UPDATE cinevjet.short_sync_control SET enabled=true,starts_at=now()-interval '31 days',ends_at=now()-interval '1 day'",
  );
  assert.equal((await runSocialSync("ADMIN", "social-admin")).status, "EXPIRED");
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.equal(
    config.crons.filter((c: { path: string }) => c.path === "/api/internal/shorts-sync").length,
    1,
  );
  assert.equal(
    config.crons.find((c: { path: string }) => c.path === "/api/internal/shorts-sync").schedule,
    "0 1 * * *",
  );
  assert.equal(
    config.crons.find((c: { path: string }) => c.path === "/api/internal/finance-worker").schedule,
    "0 0 * * *",
  );
  assert.deepEqual(await finance(), before);
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await pg.close();
});
