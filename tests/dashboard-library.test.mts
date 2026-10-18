import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  dashboardOverview,
  moneyTransactions,
  adminMovies,
  saveMovie,
  hideMovie,
  adminUsers,
  setUserStatus,
  adminRewards,
  movieInput,
} from "../src/server/dashboard";
import {
  librarySnapshot,
  bookmarkShort,
  savedShortIds,
  removeHistory,
} from "../src/server/library";
const pg = new PGlite();
for (const name of (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort())
  await pg.exec(await readFile("database/migrations/" + name, "utf8"));
await pg.exec(await readFile("database/seed.sql", "utf8"));
await pg.exec(await readFile("database/shorts-seed.sql", "utf8"));
await pg.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('admin-dash','admin@example.test','unused','Admin'),('regular-dash','regular@example.test','unused','Regular'),('other-dash','other@example.test','unused','Other'); INSERT INTO cinevjet.admin_users(user_id) VALUES('admin-dash'); INSERT INTO cinevjet.wallets(user_id) VALUES('admin-dash'),('regular-dash'),('other-dash'); INSERT INTO cinevjet.coin_wallets(user_id) VALUES('admin-dash'),('regular-dash'),('other-dash');",
);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pg,
) as unknown as NodePgDatabase;
const movie = {
  title: "Dashboard fixture",
  original_title: "",
  slug: "dashboard-fixture",
  description: "Test description",
  poster_url: "/images/reward-coin.webp",
  backdrop_url: "/images/reward-coin.webp",
  release_year: 2026,
  country: "Việt Nam",
  duration_minutes: 12,
  rating: 8.2,
  type: "MOVIE",
  status: "PUBLISHED",
  vip_required: false,
  playback_url: "/video/shorts/bunny-1.mp4",
  language: "Không lời",
  license_name: "CC BY 3.0",
  license_url: "https://creativecommons.org/licenses/by/3.0/",
  license_source_url: "https://peach.blender.org/about/",
  source_page_url: "https://peach.blender.org/",
  attribution: "Blender Foundation",
  poster_attribution: "Blender Foundation",
};
let id = "";
test("Dashboard and library use real data with access isolation", async (t) => {
  await t.test("empty financial tables render actual zeros and thirty dates", async () => {
    const d = await dashboardOverview("admin-dash");
    assert.deepEqual([d.metrics.income, d.metrics.outgoing, d.metrics.profit], [0, 0, 0]);
    assert.equal(d.chart.length, 30);
    assert.equal(d.monthlyChart.length, 12);
    assert.ok(d.chart.every((r) => r.income === 0 && r.outgoing === 0));
  });
  await t.test(
    "financial totals exclude pending/failed and include payout fee correctly",
    async () => {
      await pg.exec(
        "INSERT INTO cinevjet.deposits(id,user_id,amount,provider,status,idempotency_key) VALUES('d1','regular-dash',250000,'TEST','COMPLETED','d1'),('d2','regular-dash',500000,'TEST','PENDING','d2'),('d3','regular-dash',100000,'TEST','FAILED','d3'); INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,status,idempotency_key) VALUES('w1','regular-dash',100000,3000,'TEST','COMPLETED','w1'),('w2','regular-dash',50000,3000,'TEST','PENDING','w2');",
      );
      await pg.exec(
        "UPDATE cinevjet.deposits SET completed_at=now() WHERE status='COMPLETED'; UPDATE cinevjet.withdrawals SET completed_at=now() WHERE status='COMPLETED';",
      );
      const d = await dashboardOverview("admin-dash");
      assert.deepEqual(
        [d.metrics.income, d.metrics.outgoing, d.metrics.profit],
        [250000, 97000, 153000],
      );
      assert.equal(
        d.chart.reduce((n, r) => n + r.profit, 0),
        153000,
      );
      assert.equal(
        d.monthlyChart.reduce((n, r) => n + r.profit, 0),
        153000,
      );
      assert.equal((await moneyTransactions("admin-dash")).length, 5);
    },
  );
  await t.test("all administration reads and writes reject regular users", async () => {
    for (const call of [
      () => dashboardOverview("regular-dash"),
      () => moneyTransactions("regular-dash"),
      () => adminMovies("regular-dash"),
      () => adminUsers("regular-dash"),
      () => adminRewards("regular-dash"),
      () => saveMovie("regular-dash", movie),
      () => hideMovie("regular-dash", "missing"),
      () => setUserStatus("regular-dash", "other-dash", "SUSPENDED"),
    ])
      await assert.rejects(call(), (e: unknown) => (e as { status: number }).status === 403);
  });
  await t.test("create, edit, filter and playback source persist", async () => {
    id = (await saveMovie("admin-dash", movie)).id;
    assert.equal((await adminMovies("admin-dash", "Dashboard", "MOVIE", "PUBLISHED")).total, 1);
    await saveMovie("admin-dash", { ...movie, title: "Edited fixture", playback_url: "" }, id);
    assert.equal((await adminMovies("admin-dash", "Edited")).items[0].title, "Edited fixture");
    assert.equal(
      (
        await pg.query(
          "SELECT count(*)::int n FROM cinevjet.video_sources WHERE movie_id=$1 AND is_active",
          [id],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      saveMovie("admin-dash", movie),
      (e: unknown) => (e as { status: number }).status === 409,
    );
    assert.equal(
      movieInput.safeParse({ ...movie, playback_url: "https://example.test/v.webm" }).success,
      true,
    );
    await assert.rejects(
      saveMovie("admin-dash", { ...movie, slug: "no-source", playback_url: "" }),
      (e: unknown) => (e as { status: number }).status === 400,
    );
  });
  await t.test("library uses watch history and favorite records, with user isolation", async () => {
    await pg.query(
      "INSERT INTO cinevjet.watch_history(id,user_id,movie_id,position_seconds,duration_seconds) VALUES('h1','regular-dash',$1,30,720),('h2','other-dash',$1,60,720)",
      [id],
    );
    await pg.query("INSERT INTO cinevjet.favorites(user_id,movie_id) VALUES('regular-dash',$1)", [
      id,
    ]);
    const d = await librarySnapshot("regular-dash");
    assert.equal(d.recent[0].position_seconds, 30);
    assert.equal(d.movies[0].id, id);
    assert.equal((await librarySnapshot("other-dash")).movies.length, 0);
    assert.equal((await adminMovies("admin-dash", "Edited")).items[0].viewers, 2);
  });
  await pg.exec(
    "INSERT INTO cinevjet.short_videos(id,title,video_url,source_type) VALUES('owned-library-fixture','Owned QA short','https://example.invalid/owned.mp4','EXTERNAL')",
  );
  const sid = (
    await pg.query<{ id: string }>(
      "SELECT id FROM cinevjet.short_videos WHERE source_type='EXTERNAL' ORDER BY id LIMIT 1",
    )
  ).rows[0].id;
  await t.test("Short bookmark is idempotent and persists into the library", async () => {
    await bookmarkShort("regular-dash", sid, true);
    await bookmarkShort("regular-dash", sid, true);
    await bookmarkShort("other-dash", sid, true);
    assert.deepEqual(await savedShortIds("regular-dash"), [sid]);
    const d = await librarySnapshot("regular-dash");
    assert.equal(d.shorts.length, 1);
    assert.equal(d.shorts[0].id, sid);
  });
  await t.test("unsave and history removal affect only the current user", async () => {
    await bookmarkShort("regular-dash", sid, false);
    assert.equal((await savedShortIds("regular-dash")).length, 0);
    assert.deepEqual(await savedShortIds("other-dash"), [sid]);
    await removeHistory("regular-dash", id, null);
    assert.equal((await librarySnapshot("regular-dash")).recent.length, 0);
    assert.equal((await librarySnapshot("other-dash")).recent.length, 1);
  });
  await t.test("inactive or deleted Shorts cannot be newly saved or shown", async () => {
    await pg.query("UPDATE cinevjet.short_videos SET is_active=false WHERE id=$1", [sid]);
    await assert.rejects(
      bookmarkShort("regular-dash", sid, true),
      (e: unknown) => (e as { status: number }).status === 404,
    );
    assert.equal((await librarySnapshot("other-dash")).shorts.length, 0);
  });
  await t.test("hidden movies preserve their sources and history", async () => {
    await hideMovie("admin-dash", id);
    assert.equal((await adminMovies("admin-dash", "Edited", "", "HIDDEN")).total, 1);
    assert.equal(
      (await pg.query("SELECT count(*)::int n FROM cinevjet.video_sources WHERE movie_id=$1", [id]))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await pg.query("SELECT count(*)::int n FROM cinevjet.watch_history WHERE movie_id=$1", [id]))
        .rows[0].n,
      1,
    );
  });
  await t.test(
    "user listing excludes credentials; lock revokes sessions; unlock restores status",
    async () => {
      await pg.exec(
        "INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES('session','regular-dash','unused',now()+interval '1 day')",
      );
      const users = await adminUsers("admin-dash", "regular");
      assert.equal(users.length, 1);
      assert.ok(!("password_hash" in users[0]));
      assert.ok(!("token_hash" in users[0]));
      await setUserStatus("admin-dash", "regular-dash", "SUSPENDED");
      assert.equal((await pg.query("SELECT count(*)::int n FROM cinevjet.sessions")).rows[0].n, 0);
      await setUserStatus("admin-dash", "regular-dash", "ACTIVE");
      assert.equal((await adminUsers("admin-dash", "regular"))[0].status, "ACTIVE");
      await assert.rejects(setUserStatus("admin-dash", "admin-dash", "SUSPENDED"));
    },
  );
  await t.test(
    "existing rewards balances and schedules are unchanged by new services",
    async () => {
      const r = await adminRewards("admin-dash");
      assert.equal(r.balance, 0);
      assert.equal(r.issued, 0);
      assert.equal(r.checkins, 0);
      assert.ok(r.plans.length >= 3);
    },
  );
});
test.after(() => pg.close());
