import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { pgConfig } from "./pg-config.mjs";

export const demoIds = [
  "midnight-rain",
  "desert-heir",
  "golden-horizon",
  "last-forest",
  "sunset-run",
  "panda-warrior",
  "red-frontier",
  "beyond-the-moon",
  "harbor-of-secrets",
  "city-of-lanterns",
  "cloud-island",
  "silent-orbit",
];
export async function importCatalog(client, catalog) {
  for (const m of catalog) {
    if (
      !m.license_source_url ||
      !m.attribution ||
      !m.stream_permission?.download_enabled ||
      !m.stream_permission?.official_embed_url ||
      m.rating !== null
    )
      throw new Error("Incomplete licensed catalog entry: " + m.id);
    const old = (
      await client.query("SELECT source_page_url FROM cinevjet.movies WHERE id=$1", [m.id])
    ).rows[0];
    if (old && old.source_page_url !== m.source_page_url)
      throw new Error("Catalog identity conflict: " + m.id);
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
    await client.query(
      `INSERT INTO cinevjet.movies(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT(id) DO UPDATE SET ${columns
        .filter((c) => c !== "id")
        .map((c) => `${c}=excluded.${c}`)
        .join(",")},is_demo=false,updated_at=now()`,
      columns.map((c) => m[c]),
    );
    await client.query(
      "INSERT INTO cinevjet.video_sources(id,movie_id,provider,playback_url,quality,format,is_active) VALUES($1,$2,'BLENDER_OFFICIAL',$3,$4,'MP4',true) ON CONFLICT(id) DO UPDATE SET playback_url=excluded.playback_url,quality=excluded.quality,is_active=true",
      [`licensed-${m.id}-720p`, m.id, m.playback_url, m.quality],
    );
    for (const genre of m.genres) {
      let row = (await client.query("SELECT id FROM cinevjet.genres WHERE name=$1", [genre]))
        .rows[0];
      if (!row) {
        const key =
          "licensed-" +
          genre
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");
        row = (
          await client.query(
            "INSERT INTO cinevjet.genres(id,name,slug) VALUES($1,$2,$1) RETURNING id",
            [key, genre],
          )
        ).rows[0];
      }
      await client.query(
        "INSERT INTO cinevjet.movie_genres(movie_id,genre_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [m.id, row.id],
      );
    }
  }
  // Preserve IDs, sources, episodes, favorites and watch history. Only identified seed movies are hidden.
  await client.query(
    "UPDATE cinevjet.movies m SET status='HIDDEN',is_demo=true,updated_at=now() WHERE m.id=ANY($1::text[]) AND EXISTS(SELECT 1 FROM cinevjet.video_sources v WHERE v.movie_id=m.id AND v.playback_url='/video/bunny-trailer.mp4') AND NOT EXISTS(SELECT 1 FROM cinevjet.video_sources v WHERE v.movie_id=m.id AND v.is_active AND v.playback_url<>'/video/bunny-trailer.mp4')",
    [demoIds],
  );
}
export async function protectedFingerprint(client) {
  const names = (
    await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='cinevjet' AND table_name NOT IN ('movies','genres','movie_genres','video_sources','seasons','episodes','subtitles') ORDER BY table_name",
    )
  ).rows;
  const fingerprint = {};
  for (const { table_name } of names) {
    if (!/^[a-z_]+$/.test(table_name)) throw new Error("Unexpected relation");
    fingerprint[table_name] = (
      await client.query(
        `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS hash FROM cinevjet.${table_name} t`,
      )
    ).rows[0].hash;
  }
  return fingerprint;
}
async function main() {
  const client = new pg.Client(pgConfig());
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SELECT pg_advisory_xact_lock(839429172)");
    const before = await protectedFingerprint(client);
    await importCatalog(
      client,
      JSON.parse(await readFile("database/licensed-catalog.json", "utf8")),
    );
    if (JSON.stringify(before) !== JSON.stringify(await protectedFingerprint(client)))
      throw new Error("Non-catalog data changed; rolling back.");
    await client.query("COMMIT");
    console.log(
      "Imported 8 licensed complete films; demo movies hidden. All non-catalog data fingerprints unchanged.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
