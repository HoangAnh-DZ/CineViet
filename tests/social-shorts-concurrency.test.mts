import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgConfig } from "../scripts/pg-config.mjs";
import { parseSocialVideo } from "../src/domain/social-shorts";
import {
  saveSocialSource,
  importSocialUrls,
  checkSocialShort,
  reviewSocialShort,
  configureSocialSync,
  runSocialSync,
} from "../src/server/social-shorts";
import { shortsFeed } from "../src/server/shorts";

// The connection is forced to a blank database on the expiring, nonproduction QA branch.
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL!);
assert.notEqual(url.hostname, "ep-dawn-boat-b3eq3mnu-pooler.c-4.ap-southeast-1.aws.neon.tech");
url.hostname = "ep-dawn-boat-b3eq3mnu-pooler.c-4.ap-southeast-1.aws.neon.tech";
url.pathname = "/social_shorts_qa_20261015";
process.env.DATABASE_URL = url.toString();
const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  env: process.env,
  encoding: "utf8",
});
assert.equal(migrated.status, 0, migrated.stderr);
const pool = new Pool({ ...pgConfig(), max: 12 });
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(pool);
await pool.query(await readFile("database/seed.sql", "utf8"));
const actor = randomUUID(),
  handle = `qa_${actor.replaceAll("-", "").slice(0, 16)}`;
await pool.query(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unused','Social concurrency QA')",
  [actor, `${actor}@example.invalid`],
);
await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [actor]);
const evidence = "ISOLATED TEST ONLY: not a commercial rights claim";
const source = await saveSocialSource(actor, {
  provider: "TIKTOK",
  source_url: `https://www.tiktok.com/@${handle}`,
  creator_name: "QA Creator",
  authorization_status: "VERIFIED",
  permission_evidence: evidence,
  sync_enabled: true,
  confirm_rights: true,
});
const urls = Array.from(
  { length: 12 },
  (_, i) => `https://www.tiktok.com/@${handle}/video/${7000000000000000000n + BigInt(i)}`,
);
const originalFetch = globalThis.fetch;
let calls = 0,
  hold = false,
  entered: () => void = () => {},
  release: () => void = () => {};
let gate = Promise.resolve();
globalThis.fetch = async (input, init) => {
  calls++;
  const u = new URL(String(input));
  assert.equal(u.origin, "https://www.tiktok.com");
  assert.equal(u.pathname, "/oembed");
  assert.equal(init?.redirect, "error");
  if (hold) {
    entered();
    await gate;
  }
  const v = parseSocialVideo(u.searchParams.get("url")!);
  return Response.json({
    type: "video",
    provider_name: "TikTok",
    title: `Isolated clip ${v.providerVideoId}`,
    author_name: "QA Creator",
    author_url: v.creatorUrl,
  });
};
test("real PostgreSQL concurrency, publication cap and no financial effects", async (t) => {
  await t.test("concurrent duplicate imports preserve one row per provider video", async () => {
    const r = await Promise.all(
      Array.from({ length: 4 }, () => importSocialUrls(actor, { source_id: source.id, urls })),
    );
    assert.equal(
      r.reduce((sum, v) => sum + v.added, 0),
      12,
    );
    assert.equal(
      Number(
        (
          await pool.query("SELECT count(*) n FROM cinevjet.short_videos WHERE source_id=$1", [
            source.id,
          ])
        ).rows[0].n,
      ),
      12,
    );
    const rows = (
      await pool.query("SELECT id FROM cinevjet.short_videos WHERE source_id=$1", [source.id])
    ).rows;
    await Promise.all(
      rows.map(async (r) => {
        await checkSocialShort(actor, r.id);
        await reviewSocialShort(actor, {
          id: r.id,
          decision: "APPROVE",
          permission_evidence: evidence,
          confirm_rights: true,
        });
      }),
    );
    await configureSocialSync(actor, { enabled: true, daily_target: 5 });
  });
  await t.test("overlapping syncs share a database lease and publish at most five", async () => {
    gate = new Promise<void>((r) => (release = r));
    const atNetwork = new Promise<void>((r) => (entered = r));
    hold = true;
    let busy = 0;
    const pending = Array.from({ length: 3 }, () =>
      runSocialSync("ADMIN", actor).then((r) => {
        if (r.status === "BUSY" && ++busy === 2) release();
        return r;
      }),
    );
    await atNetwork;
    const timer = setTimeout(release, 5000);
    const results = await Promise.all(pending);
    clearTimeout(timer);
    hold = false;
    assert.equal(
      results.reduce((sum, r) => sum + r.added, 0),
      5,
    );
    assert.equal(busy, 2);
    const r = (
      await pool.query(
        "SELECT count(*)::int n,count(DISTINCT short_id)::int unique_count FROM cinevjet.short_publications",
      )
    ).rows[0];
    assert.deepEqual(r, { n: 5, unique_count: 5 });
    const day = (
      await pool.query(
        "SELECT videos_added,calendar_date::text AS day,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS expected FROM cinevjet.short_sync_days",
      )
    ).rows[0];
    assert.equal(day.videos_added, 5);
    assert.equal(day.day, day.expected);
  });
  await t.test(
    "retries do not call providers or consume quota again; new records need no redeploy",
    async () => {
      const before = calls;
      const runs = await Promise.all(
        Array.from({ length: 6 }, () => runSocialSync("ADMIN", actor)),
      );
      assert.ok(runs.every((r) => r.status === "DAILY_LIMIT"));
      assert.equal(calls, before);
      assert.equal((await shortsFeed()).items.length, 5);
      const finance = (
        await pool.query(
          "SELECT (SELECT count(*)::int FROM cinevjet.wallet_ledger) cash,(SELECT count(*)::int FROM cinevjet.coin_ledger) coins,(SELECT count(*)::int FROM cinevjet.vip_subscriptions) vip,(SELECT count(*)::int FROM cinevjet.payos_orders) orders",
        )
      ).rows[0];
      assert.deepEqual(finance, { cash: 0, coins: 0, vip: 0, orders: 0 });
    },
  );
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await pool.end();
});
