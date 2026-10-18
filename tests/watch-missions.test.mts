import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { pgConfig } from "../scripts/pg-config.mjs";
import { verifiedWatchMs, watchDaySegments } from "../src/domain/watch-rewards";
import {
  missionsSnapshot,
  startRewardWatch,
  heartbeatRewardWatch,
  claimMission,
} from "../src/server/missions";
import { rewardsSnapshot, claimDailyCheckIn } from "../src/server/rewards";
if (!(process.env.DATABASE_URL && process.env.LEGACY_MISSIONS_QA === "1")) {
  test("Legacy dedicated Neon QA suite", {skip: "Dedicated QA credentials/branch unavailable; current contracts, coins, withdrawals and playback claims are covered by vip-bank.test.mts"}, () => {});
} else {
const url = new URL(process.env.DATABASE_URL!);
url.hostname = "ep-patient-surf-b3s99cl5-pooler.c-4.ap-southeast-1.aws.neon.tech";
process.env.DATABASE_URL = url.toString();
const pool = new Pool({ ...pgConfig(), max: 8 }),
  real = drizzle(pool);
let now = Date.parse("2026-12-11T03:00:00Z");
const db = {
  ...real,
  transaction: (
    fn: Parameters<typeof real.transaction>[0],
    options?: Parameters<typeof real.transaction>[1],
  ) =>
    real.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('cinevjet.test_now',${new Date(now).toISOString()},true)`,
      );
      return fn(tx);
    }, options),
};
(globalThis as any).cinevjetDatabase = db;
const ids: string[] = [];
async function user() {
  const id = randomUUID();
  ids.push(id);
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'test-only','Mission QA')",
    [id, id + "@watch-missions.example.test"],
  );
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  return id;
}
async function balance(id: string) {
  return Number(
    (await pool.query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [id])).rows[0]
      .balance,
  );
}
test("validated elapsed time: stalls, seeks, duplicates, gaps and acceleration earn zero", () => {
  const p = { at: 0, position: 0, playing: true };
  assert.equal(verifiedWatchMs(p, { at: 15000, position: 15, playing: true }, 1000), 15000);
  for (const n of [
    { at: 15000, position: 0, playing: true },
    { at: 0, position: 15, playing: true },
    { at: 31000, position: 31, playing: true },
    { at: 15000, position: 30, playing: true },
    { at: 15000, position: 1001, playing: true },
  ])
    assert.equal(verifiedWatchMs(p, n, 1000), 0);
  assert.equal(verifiedWatchMs(p, { at: 15000, position: 15, playing: false }, 1000), 15000);
  assert.equal(
    verifiedWatchMs({ ...p, playing: false }, { at: 15000, position: 15, playing: true }, 1000),
    0,
  );
});
test("Vietnam midnight divides eligible time into the correct two dates", () => {
  const start = Date.parse("2026-12-11T16:59:50Z"),
    end = start + 15000;
  assert.deepEqual(watchDaySegments(start, end, 15000), [
    { day: "2026-12-11", ms: 10000 },
    { day: "2026-12-12", ms: 5000 },
  ]);
});
test("real PostgreSQL daily missions, tracking and atomic claims", async (t) => {
  await pool.query(
    "CREATE OR REPLACE FUNCTION cinevjet.reward_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT COALESCE(NULLIF(current_setting('cinevjet.test_now',true),'')::timestamptz,clock_timestamp()) $$",
  );
  try {
    const source = (
      await pool.query(
        "SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id WHERE v.is_active AND v.format='MP4' AND NOT m.vip_required AND m.status='PUBLISHED' AND m.type='MOVIE' AND v.episode_id IS NULL ORDER BY v.id LIMIT 1",
      )
    ).rows[0].id;
    const id = await user();
    let position = 0;
    let session = await startRewardWatch(id, { source_id: source, position });
    await t.test(
      "new day starts at genuine zero with database-configured 100/200/400 rewards",
      async () => {
        const s = await missionsSnapshot(id);
        assert.deepEqual(
          s.missions.map((m) => [m.target_seconds, m.reward, m.status, m.watched_seconds]),
          [
            [600, 100, "IN_PROGRESS", 0],
            [1800, 200, "IN_PROGRESS", 0],
            [3600, 400, "IN_PROGRESS", 0],
          ],
        );
        assert.equal(await balance(id), 0);
      },
    );
    await t.test("client minutes, unknown fields and early claims are rejected", async () => {
      await assert.rejects(
        heartbeatRewardWatch(id, { ...session, position: 600, playing: true, minutes: 10 }),
      );
      await assert.rejects(
        claimMission(id, { mission_id: "WATCH_10", calendar_date: "2026-12-11" }),
        /Chưa đủ/,
      );
      assert.equal(await balance(id), 0);
    });
    await t.test(
      "source authorization rejects nonexistent sources and another user's token",
      async () => {
        await assert.rejects(startRewardWatch(id, { source_id: "missing", position: 0 }));
        const other = await user();
        await assert.rejects(
          heartbeatRewardWatch(other, { ...session, position: 15, playing: true }),
        );
      },
    );
    await t.test(
      "active tab lease prevents a second tab from earning overlapping time",
      async () => {
        await assert.rejects(startRewardWatch(id, { source_id: source, position: 0 }), /tab khác/);
      },
    );
    await t.test(
      "first valid heartbeat persists real progress without crediting coins",
      async () => {
        now += 15000;
        position += 15;
        const payload = { ...session, position, playing: true };
        const replies = await Promise.all(Array.from({ length: 4 }, () => heartbeatRewardWatch(id, payload)));
        session = replies[0];
        assert.ok(replies.every(r => r.nonce === session.nonce));
        assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 15);
        assert.equal(await balance(id), 0);
        await heartbeatRewardWatch(id, payload);
        assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 15);
        await assert.rejects(heartbeatRewardWatch(id, { ...payload, position: 16 }));
      },
    );
    await t.test(
      "pause, repeated paused heartbeats and resume boundaries cannot earn time",
      async () => {
        now += 15000;
        session = await heartbeatRewardWatch(id, { ...session, position, playing: false });
        now += 300000;
        session = await heartbeatRewardWatch(id, { ...session, position, playing: false });
        now += 15000;
        session = await heartbeatRewardWatch(id, { ...session, position, playing: true });
        assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 15);
      },
    );
    await t.test("seeking and accelerated positions cannot shortcut watch time", async () => {
      now += 15000;
      position += 600;
      session = await heartbeatRewardWatch(id, { ...session, position, playing: true });
      now += 15000;
      position += 30;
      session = await heartbeatRewardWatch(id, { ...session, position, playing: true });
      assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 15);
    });
    await t.test(
      "10 minutes of bounded consecutive playback becomes available and survives a fresh read",
      async () => {
        for (let n = 0; n < 39; n++) {
          now += 15000;
          position += 15;
          session = await heartbeatRewardWatch(id, { ...session, position, playing: true });
        }
        assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 600);
        assert.equal((await missionsSnapshot(id)).missions[0].status, "AVAILABLE");
        assert.equal(await balance(id), 0);
      },
    );
    await t.test(
      "eight concurrent claims credit exactly 100 coins and one real ledger entry",
      async () => {
        const claims = await Promise.all(
          Array.from({ length: 8 }, () =>
            claimMission(id, { mission_id: "WATCH_10", calendar_date: "2026-12-11" }),
          ),
        );
        assert.ok(claims.every((s) => s.missions[0].status === "CLAIMED"));
        assert.equal(await balance(id), 100);
        const ledger = (
          await pool.query(
            "SELECT amount,type,reference_type FROM cinevjet.coin_ledger WHERE user_id=$1",
            [id],
          )
        ).rows;
        assert.deepEqual(
          ledger.map((r) => [Number(r.amount), r.type, r.reference_type]),
          [[100, "MISSION", "DAILY_MISSION"]],
        );
        assert.equal((await rewardsSnapshot(id)).ledger[0].reason, "MISSION");
      },
    );
    await t.test(
      "check-in remains independent and idempotent alongside mission claims",
      async () => {
        const checkin = await claimDailyCheckIn(id);
        assert.equal(checkin.claimed_today, true);
        const before = await balance(id);
        await claimDailyCheckIn(id);
        assert.equal(await balance(id), before);
        assert.equal((await missionsSnapshot(id)).missions[0].status, "CLAIMED");
      },
    );
    await t.test("two simultaneous new tabs receive exactly one active lease", async () => {
      const fresh = await user();
      const results = await Promise.allSettled([
        startRewardWatch(fresh, { source_id: source, position: 0 }),
        startRewardWatch(fresh, { source_id: source, position: 0 }),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected").length, 1);
      assert.equal((await missionsSnapshot(fresh)).missions[0].watched_seconds, 0);
    });
    await t.test("30/60 minute missions credit their configured rewards once after bounded playback", async () => {
      const longViewer = await user();
      let longPosition = 0, longSession = await startRewardWatch(longViewer, { source_id: source, position: 0 });
      for (let n = 1; n <= 120; n++) {
        now += 30000; longPosition += 30;
        longSession = await heartbeatRewardWatch(longViewer, { ...longSession, position: longPosition, playing: true });
        if (n === 59) {
          assert.equal((await missionsSnapshot(longViewer)).missions[1].status, "IN_PROGRESS");
          await assert.rejects(claimMission(longViewer, { mission_id: "WATCH_30", calendar_date: "2026-12-11" }));
        }
        if (n === 60) assert.equal((await missionsSnapshot(longViewer)).missions[1].status, "AVAILABLE");
      }
      assert.equal(await balance(longViewer), 0);
      assert.ok((await missionsSnapshot(longViewer)).missions.every(m => m.status === "AVAILABLE"));
      for (const mission_id of ["WATCH_10", "WATCH_30", "WATCH_60"])
        await claimMission(longViewer, { mission_id, calendar_date: "2026-12-11" });
      assert.equal(await balance(longViewer), 700);
      assert.equal((await pool.query("SELECT id FROM cinevjet.coin_ledger WHERE user_id=$1 AND type='MISSION'", [longViewer])).rowCount, 3);
    });
    await t.test("expired lease accepts a new tab but does not count unobserved time", async () => {
      now += 60000;
      session = await startRewardWatch(id, { source_id: source, position });
      assert.equal((await missionsSnapshot(id)).missions[1].watched_seconds, 600);
    });
    await t.test(
      "midnight resets eligibility, rejects stale claims and preserves past ledger",
      async () => {
        now = Date.parse("2026-12-11T16:59:50Z");
        session = await startRewardWatch(id, { source_id: source, position });
        now += 15000;
        position += 15;
        session = await heartbeatRewardWatch(id, { ...session, position, playing: true });
        const state = await missionsSnapshot(id);
        assert.equal(state.calendar_date, "2026-12-12");
        assert.equal(state.missions[0].watched_seconds, 5);
        assert.equal(state.missions[0].status, "IN_PROGRESS");
        await assert.rejects(
          claimMission(id, { mission_id: "WATCH_10", calendar_date: "2026-12-11" }),
          /ngày mới/,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT watched_ms FROM cinevjet.daily_watch_progress WHERE user_id=$1 AND calendar_date='2026-12-11'",
                [id],
              )
            ).rows[0].watched_ms,
          ),
          610000,
        );
      },
    );
    await t.test("wallet overflow rolls back claim and ledger together", async () => {
      const overflow = await user();
      await pool.query(
        "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms) VALUES($1,'2026-12-12',600000)",
        [overflow],
      );
      await pool.query(
        "UPDATE cinevjet.coin_wallets SET balance=9007199254740991 WHERE user_id=$1",
        [overflow],
      );
      await assert.rejects(
        claimMission(overflow, { mission_id: "WATCH_10", calendar_date: "2026-12-12" }),
      );
      assert.equal(
        (
          await pool.query("SELECT id FROM cinevjet.daily_mission_claims WHERE user_id=$1", [
            overflow,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (await pool.query("SELECT id FROM cinevjet.coin_ledger WHERE user_id=$1", [overflow]))
          .rowCount,
        0,
      );
    });
  } finally {
    for (const table of ["coin_ledger", "daily_checkins"])
      await pool.query(`DELETE FROM cinevjet.${table} WHERE user_id=ANY($1::text[])`, [ids]);
    await pool.query(
      "DELETE FROM cinevjet.users WHERE id=ANY($1::text[]) AND email LIKE '%@watch-missions.example.test'",
      [ids],
    );
    await pool.query(
      "CREATE OR REPLACE FUNCTION cinevjet.reward_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT clock_timestamp() $$",
    );
    await pool.end();
  }
});

}
