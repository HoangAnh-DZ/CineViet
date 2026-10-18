import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import pg from "pg";
import { pgConfig } from "./pg-config.mjs";
import { protectedFingerprint } from "./import-licensed-catalog.mjs";
const columns = [
  "id",
  "title",
  "original_title",
  "slug",
  "description",
  "poster_url",
  "backdrop_url",
  "release_year",
  "country",
  "duration_minutes",
  "duration_seconds",
  "rating",
  "type",
  "status",
  "vip_required",
  "language",
  "license_name",
  "license_url",
  "license_source_url",
  "source_page_url",
  "attribution",
  "poster_attribution",
];
async function sources(client, movieId, episodeId, sources, prefix, rights) {
  const credit = rights
    ? Object.fromEntries(
        [
          "license_name",
          "license_url",
          "license_source_url",
          "source_page_url",
          "attribution",
          "poster_attribution",
        ].map((k) => [k, rights[k]]),
      )
    : null;
  for (const s of sources) {
    assert.ok(["MP4", "WEBM"].includes(s.format));
    assert.match(s.url, /^https:\/\/(?:video\.blender\.org|upload\.wikimedia\.org)\//);
    const id =
      prefix === "licensed"
        ? `licensed-${movieId}-${s.quality}`
        : `discovery-${episodeId || movieId}-${s.quality}`;
    await client.query(
      "INSERT INTO cinevjet.video_sources(id,movie_id,episode_id,provider,playback_url,quality,format,bitrate_bps,provenance,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,true) ON CONFLICT(id) DO NOTHING",
      [
        id,
        movieId,
        episodeId,
        s.provider,
        s.url,
        s.quality,
        s.format,
        s.bitrate_bps || null,
        credit ? JSON.stringify(credit) : null,
      ],
    );
    // Preserve an existing source's URL and active/hidden decision, including Admin edits.
    if (s.bitrate_bps)
      await client.query(
        "UPDATE cinevjet.video_sources SET bitrate_bps=$1 WHERE id=$2 AND playback_url=$3 AND bitrate_bps IS NULL",
        [s.bitrate_bps, id, s.url],
      );
  }
}
export async function importDiscovery(client, catalog, variants) {
  assert.equal(new Set(catalog.map((m) => m.id)).size, catalog.length, "Duplicate movie IDs");
  for (const m of catalog) {
    assert.ok(
      m.license_name && m.license_url && m.license_source_url && m.attribution && m.verified_at,
    );
    assert.ok(m.sources?.length || m.episodes?.length);
    assert.equal(m.rating, null);
    const old = (
      await client.query("SELECT source_page_url FROM cinevjet.movies WHERE id=$1", [m.id])
    ).rows[0];
    if (old && old.source_page_url !== m.source_page_url)
      throw new Error("Existing movie identity conflict: " + m.id);
    await client.query(
      `INSERT INTO cinevjet.movies(${columns.join(",")}) VALUES(${columns.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT(id) DO NOTHING`,
      columns.map((c) => m[c]),
    );
    for (const name of m.genres) {
      let genre = (await client.query("SELECT id FROM cinevjet.genres WHERE name=$1", [name]))
        .rows[0];
      if (!genre) {
        const slug =
          "discovery-" +
          name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/đ/g, "d")
            .replace(/[^a-z0-9]+/g, "-");
        genre = (
          await client.query(
            "INSERT INTO cinevjet.genres(id,name,slug) VALUES($1,$2,$1) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id",
            [slug, name],
          )
        ).rows[0];
      }
      await client.query(
        "INSERT INTO cinevjet.movie_genres(movie_id,genre_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [m.id, genre.id],
      );
    }
    await sources(client, m.id, null, m.sources || [], "discovery", m);
    for (const e of m.episodes || []) {
      assert.ok(e.license_source_url && e.sources.length && e.duration_seconds > 0);
      await client.query(
        "INSERT INTO cinevjet.seasons(id,movie_id,season_number,title) VALUES($1,$2,$3,$4) ON CONFLICT(movie_id,season_number) DO NOTHING",
        [
          m.id + "-season-" + e.season,
          m.id,
          e.season,
          m.genres.includes("Series tập ngắn") ? "Tuyển tập" : "Các chương",
        ],
      );
      await client.query(
        "INSERT INTO cinevjet.episodes(id,movie_id,season_number,episode_number,title,duration_seconds,thumbnail_url,status) VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED') ON CONFLICT(id) DO NOTHING",
        [e.id, m.id, e.season, e.episode_number, e.title, e.duration_seconds, e.thumbnail_url],
      );
      await sources(client, m.id, e.id, e.sources, "discovery", e);
    }
  }
  for (const m of variants) await sources(client, m.id, null, m.sources, "licensed");
}
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, "ep-wandering-night-b339mvov-pooler.c-4.ap-southeast-1.aws.neon.tech");
  assert.equal(url.pathname, "/cinevjet");
  const catalog = JSON.parse(await readFile("database/discovery-expansion.json", "utf8")),
    variants = JSON.parse(await readFile("database/streaming-variants.json", "utf8"));
  const proof = JSON.parse(await readFile(".vercel/discovery-source-verification.json", "utf8"));
  assert.equal(
    proof.manifestSha256,
    (await import("node:crypto"))
      .createHash("sha256")
      .update(await readFile("database/discovery-expansion.json"))
      .digest("hex"),
  );
  assert.equal(
    proof.variantsSha256,
    (await import("node:crypto"))
      .createHash("sha256")
      .update(await readFile("database/streaming-variants.json"))
      .digest("hex"),
  );
  assert.equal(proof.failures, 0, "All sources must pass before publication");
  const browserProof = JSON.parse(await readFile(".vercel/discovery-browser-results.json", "utf8"));
  assert.equal(browserProof.passed, true, "Browser playback verification is required");
  assert.equal(browserProof.manifestSha256, proof.manifestSha256);
  assert.equal(browserProof.items.filter((item) => item.passed).length, 62);
  const adminProof = JSON.parse(await readFile(".vercel/discovery-admin-results.json", "utf8"));
  assert.equal(adminProof.passed, true, "Admin browser verification is required");
  const ready = JSON.parse(await readFile(".vercel/discovery-production-ready.json", "utf8"));
  assert.equal(ready.projectId, "prj_pS99SOdXtn13R4CD2XyIvmBgimCA");
  assert.equal(ready.nativePlaybackRuntimeVerified, true);
  const config = pgConfig();
  const direct = new URL(config.connectionString);
  direct.hostname = direct.hostname.replace("-pooler", "");
  const client = new pg.Client({ ...config, connectionString: direct.toString() });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(839429172)");
    const before = await protectedFingerprint(client);
    const prior = {};
    for (const table of ["movies", "episodes", "seasons", "video_sources"]) {
      const ids = (await client.query(`SELECT id FROM cinevjet.${table}`)).rows.map(
        (row) => row.id,
      );
      const value =
        table === "video_sources" ? "to_jsonb(t)-'bitrate_bps'-'provenance'" : "to_jsonb(t)";
      const hash = async () =>
        (
          await client.query(
            `SELECT md5(COALESCE(jsonb_agg(${value} ORDER BY id)::text,'[]')) hash FROM cinevjet.${table} t WHERE id=ANY($1::text[])`,
            [ids],
          )
        ).rows[0].hash;
      prior[table] = { hash, before: await hash() };
    }
    const countTitles = async () =>
      (
        await client.query("SELECT count(*)::int n FROM cinevjet.movies WHERE id=ANY($1::text[])", [
          catalog.map((movie) => movie.id),
        ])
      ).rows[0].n;
    const titlesBefore = await countTitles();
    await importDiscovery(client, catalog, variants);
    assert.deepEqual(await protectedFingerprint(client), before, "Non-catalog records changed");
    for (const entry of Object.values(prior))
      assert.equal(
        await entry.hash(),
        entry.before,
        "Existing catalog metadata/source identity changed",
      );
    const inserted = (await countTitles()) - titlesBefore;
    await client.query("COMMIT");
    console.log(
      "Published " +
        inserted +
        " verified titles / " +
        catalog.reduce((n, m) => n + (m.episodes?.length || 0), 0) +
        " episodes. Existing metadata/IDs preserved; all non-catalog fingerprints unchanged.",
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
