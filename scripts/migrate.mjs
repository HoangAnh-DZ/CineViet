import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { pgConfig } from "./pg-config.mjs";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before migrating.");
const client = new pg.Client(pgConfig());
try {
  await client.connect();
  await client.query("BEGIN");
  // Transaction-scoped locking is safe with Neon transaction pooling.
  await client.query("SELECT pg_advisory_xact_lock(839429170)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.cinevjet_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const source = await readFile("database/migrations/" + name, "utf8"),
      checksum = createHash("sha256").update(source).digest("hex");
    const result = await client.query(
      "SELECT checksum FROM public.cinevjet_migrations WHERE name=$1",
      [name],
    );
    if (result.rows.length) {
      if (result.rows[0].checksum !== checksum)
        throw new Error("Applied migration changed: " + name);
      continue;
    }
    await client.query(source);
    await client.query("INSERT INTO public.cinevjet_migrations(name,checksum) VALUES($1,$2)", [
      name,
      checksum,
    ]);
    console.log("Applied " + name);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration failed; transaction rolled back.");
  process.exitCode = 1;
} finally {
  await client.end();
}
