import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  moviePresentation,
  userPresentation,
  memberActivity,
} from "../src/features/admin/presentation-data";
const pg = new PGlite();
for (const f of (await readdir("database/migrations")).filter((f) => f.endsWith(".sql")).sort())
  await pg.exec(await readFile("database/migrations/" + f, "utf8"));
await pg.exec(await readFile("database/seed.sql", "utf8"));
await pg.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('admin-ui','admin@ui.test','never-expose','Admin'),('member-ui','member@ui.test','never-expose','Member'); INSERT INTO cinevjet.admin_users(user_id) VALUES('admin-ui'); INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES('admin-ui',200),('member-ui',700); INSERT INTO cinevjet.wallets(user_id) VALUES('admin-ui'),('member-ui'); INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,started_at,expires_at,status) VALUES('ui-vip','member-ui','VIP_BASIC',now()-interval '1 day',now()+interval '6 days','ACTIVE'); INSERT INTO cinevjet.watch_history(id,user_id,movie_id,episode_id,position_seconds,duration_seconds) VALUES('ui-watch','member-ui','desert-heir','desert-heir-ep-1',450,1200); INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES('ui-coin','member-ui',700,'DAILY_CHECKIN_VIP_BASIC','TEST','ui-coin'); INSERT INTO cinevjet.deposits(id,user_id,amount,provider,status,idempotency_key) VALUES('ui-deposit','member-ui',250000,'TEST','COMPLETED','ui-deposit');",
);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pg,
) as unknown as NodePgDatabase;
test("dashboard presentation reads require Admin", async () => {
  for (const f of [
    () => moviePresentation("member-ui"),
    () => userPresentation("member-ui"),
    () => memberActivity("member-ui", "admin-ui"),
  ])
    await assert.rejects(f(), (e: unknown) => (e as { status: number }).status === 403);
});
test("episode column reads existing series episodes", async () => {
  const d = await moviePresentation("admin-ui");
  assert.equal(d.items.find((m) => m.id === "desert-heir")?.episodes, 10);
  assert.equal(d.items.find((m) => m.id === "midnight-rain")?.episodes, 0);
});
test("member columns show actual active VIP and coin balances", async () => {
  const d = await userPresentation("admin-ui");
  assert.equal(d.find((u) => u.id === "member-ui")?.coins, 700);
  assert.equal(d.find((u) => u.id === "member-ui")?.vip, "VIP Basic");
  assert.equal(d.find((u) => u.id === "admin-ui")?.vip, "Free");
  assert.ok(!JSON.stringify(d).includes("never-expose"));
  assert.ok(d.every((u) => !("password_hash" in u) && !("token_hash" in u)));
});
test("member drawer activity belongs only to selected member", async () => {
  const d = await memberActivity("admin-ui", "member-ui");
  assert.equal(d.watch[0].position, 450);
  assert.equal(d.rewards[0].amount, 700);
  assert.equal(d.transactions[0].amount, 250000);
  const own = await memberActivity("admin-ui", "admin-ui");
  assert.equal(own.watch.length + own.rewards.length + own.transactions.length, 0);
});
test("member drawer rejects missing users", async () => {
  await assert.rejects(
    memberActivity("admin-ui", "missing"),
    (e: unknown) => (e as { status: number }).status === 404,
  );
});
test("presentation reads preserve all existing database rows", async () => {
  const tables = [
    "users",
    "movies",
    "episodes",
    "coin_wallets",
    "vip_subscriptions",
    "watch_history",
    "coin_ledger",
    "deposits",
  ];
  const fingerprint = async () =>
    Promise.all(
      tables.map((t) =>
        pg.query(
          `SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text) AS hash FROM cinevjet.${t} t`,
        ),
      ),
    );
  const before = await fingerprint();
  await moviePresentation("admin-ui");
  await userPresentation("admin-ui");
  await memberActivity("admin-ui", "member-ui");
  assert.deepEqual(await fingerprint(), before);
});
test.after(async () => {
  await pg.close();
});

