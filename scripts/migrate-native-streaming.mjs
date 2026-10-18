import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pgConfig } from "./pg-config.mjs";
import { protectedFingerprint } from "./import-licensed-catalog.mjs";

const name = "0018_native_streaming.sql";
const source = await readFile("database/migrations/" + name);
const checksum = createHash("sha256").update(source).digest("hex");
const config = pgConfig();
const url = new URL(config.connectionString);
assert.equal(url.hostname, "ep-wandering-night-b339mvov-pooler.c-4.ap-southeast-1.aws.neon.tech");
assert.equal(url.pathname, "/cinevjet");
url.hostname = url.hostname.replace("-pooler", "");
const client = new pg.Client({ ...config, connectionString: url.toString() });
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(839429170)");
  const old = (
    await client.query("SELECT checksum FROM public.cinevjet_migrations WHERE name=$1", [name])
  ).rows[0];
  if (old) {
    assert.equal(old.checksum, checksum, "Migration checksum mismatch");
    await client.query("ROLLBACK");
    console.log(name + " already applied; checksum verified.");
  } else {
    const before = await protectedFingerprint(client);
    const sourceFingerprint = async () =>
      (
        await client.query(
          "SELECT md5(COALESCE(jsonb_agg(to_jsonb(t)-'bitrate_bps'-'provenance' ORDER BY id)::text,'[]')) hash FROM cinevjet.video_sources t",
        )
      ).rows[0].hash;
    const sourcesBefore = await sourceFingerprint();
    await client.query(source.toString("utf8"));
    assert.deepEqual(
      await protectedFingerprint(client),
      before,
      "Protected non-catalog records changed",
    );
    assert.equal(await sourceFingerprint(), sourcesBefore, "Existing source records changed");
    await client.query("INSERT INTO public.cinevjet_migrations(name,checksum) VALUES($1,$2)", [
      name,
      checksum,
    ]);
    await client.query("COMMIT");
    await writeFile(
      ".vercel/native-streaming-migration.json",
      JSON.stringify({
        name,
        checksum,
        protectedRecordsUnchanged: true,
        existingSourcesUnchanged: true,
      }),
    );
    console.log(
      name + " PASS; capability widened, protected records and existing sources unchanged.",
    );
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Native streaming migration rolled back.", {
    code: error.code || "CHECK_FAILED",
    reason: error.code ? undefined : error.message,
  });
  process.exitCode = 1;
} finally {
  await client.end();
}
