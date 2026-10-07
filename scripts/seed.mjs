import pg from "pg";
import { pgConfig } from "./pg-config.mjs";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before seeding.");
const client = new pg.Client(pgConfig());
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(839429171)");
  await client.query(await readFile("database/seed.sql", "utf8"));
  await client.query("COMMIT");
  console.log(
    "Seed applied: 12 fictional movies, 4 series, 40 episodes, genres and VIP plans. No users or money transactions.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Seed failed; transaction rolled back.");
  process.exitCode = 1;
} finally {
  await client.end();
}
