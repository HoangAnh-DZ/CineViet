import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { importCatalog, protectedFingerprint } from "../scripts/import-licensed-catalog.mjs";
import { importDiscovery } from "../scripts/import-discovery.mjs";
import {
  searchCatalog,
  findMovie,
  movieEpisodes,
  playback,
  homeCatalog,
} from "../src/server/catalog";
import { setFavorite, favoriteMovies, saveWatchProgress, history } from "../src/server/account";
import { movieEditorData, saveMovie } from "../src/server/dashboard";
import { autoSource, lowerSource } from "../src/domain/playback";
import { ApiError, readBody } from "../src/server/http";
import type { VideoSource } from "../src/domain/models";
const old = JSON.parse(await readFile("database/licensed-catalog.json", "utf8"));
const catalog = JSON.parse(await readFile("database/discovery-expansion.json", "utf8"));
const variants = JSON.parse(await readFile("database/streaming-variants.json", "utf8"));
test("Admin series payloads fit a bounded movie-specific limit; ordinary APIs keep 8KB", async () => {
  const payload = JSON.stringify(catalog.find((movie) => movie.id === "judex-1916"));
  assert.ok(payload.length > 8192);
  const request = (body: string) =>
    new Request("https://example.invalid/api/admin/movies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  await assert.rejects(
    () => readBody(request(payload)),
    (error) => error instanceof ApiError && error.status === 413,
  );
  assert.deepEqual(await readBody(request(payload), 512 * 1024), JSON.parse(payload));
  await assert.rejects(
    () => readBody(request(JSON.stringify("x".repeat(512 * 1024))), 512 * 1024),
    (error) => error instanceof ApiError && error.status === 413,
  );
  for (const route of [
    "src/app/api/admin/movies/route.ts",
    "src/app/api/admin/movies/[id]/route.ts",
  ]) {
    const source = await readFile(route, "utf8");
    assert.match(source, /readBody\(r, 512 \* 1024\)/);
    assert.ok(source.indexOf("await requireAdmin()") < source.indexOf("readBody(r,"));
  }
});
const db = new PGlite();
for (const name of (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort())
  await db.exec(await readFile("database/migrations/" + name, "utf8"));
await db.exec(await readFile("database/seed.sql", "utf8"));
await importCatalog(db, old);
await db.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('discovery-admin','admin@discovery.invalid','unused','QA Admin'),('discovery-viewer','viewer@discovery.invalid','unused','QA Viewer'); INSERT INTO cinevjet.admin_users(user_id) VALUES('discovery-admin'); INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES('discovery-viewer',100500); INSERT INTO cinevjet.wallets(user_id,balance) VALUES('discovery-viewer',0)",
);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  db,
) as unknown as NodePgDatabase;
test("native Auto uses only actual variants and fits a conservative bandwidth budget", () => {
  const sources = [
    ["240p", 393341],
    ["360p", 655618],
    ["480p", 934450],
    ["720p", 1680108],
  ].map(([quality, bitrate]) => ({
    id: String(quality),
    quality,
    bitrate_bps: bitrate,
    protocol: "MP4",
    url: "https://example.invalid/" + quality + ".mp4",
    movie_id: "spring",
    mime_type: "video/mp4",
  })) as VideoSource[];
  assert.equal(autoSource(sources, { downlink: 0.6 })?.id, "240p");
  assert.equal(autoSource(sources, { downlink: 1.5 })?.id, "480p");
  assert.equal(autoSource(sources, { downlink: 10 })?.id, "720p");
  assert.equal(autoSource(sources, { downlink: 10, saveData: true })?.id, "240p");
  assert.equal(lowerSource(sources, sources[3])?.id, "480p");
  assert.equal(lowerSource(sources, sources[0]), undefined);
  assert.equal(autoSource([]), undefined);
});
test("20 cleared titles and 49 complete episodes import idempotently without touching protected records", async () => {
  const before = await protectedFingerprint(db);
  const previous = (
    await db.query("SELECT to_jsonb(m) data FROM cinevjet.movies m WHERE id='spring'")
  ).rows[0].data;
  await importDiscovery(db, catalog, variants);
  await importDiscovery(db, catalog, variants);
  assert.deepEqual(await protectedFingerprint(db), before);
  assert.deepEqual(
    (await db.query("SELECT to_jsonb(m) data FROM cinevjet.movies m WHERE id='spring'")).rows[0]
      .data,
    previous,
  );
  assert.equal(catalog.length, 20);
  assert.equal(new Set(catalog.map((m) => m.id)).size, 20);
  assert.equal(catalog.filter((m) => m.type === "MOVIE" && m.duration_minutes >= 40).length, 8);
  assert.equal(catalog.filter((m) => m.type === "SERIES").length, 7);
  assert.equal(
    catalog.reduce((n, m) => n + (m.episodes?.length || 0), 0),
    49,
  );
  assert.equal((await searchCatalog({})).total, 28);
  assert.equal((await searchCatalog({ type: "SERIES" })).total, 7);
  assert.equal((await searchCatalog({ genre: "Series tập ngắn" })).total, 4);
});
test("every published movie/episode has rights, metadata, native source and unique original order", async () => {
  const urls = new Set();
  for (const m of catalog) {
    assert.ok(m.verified_at && m.license_source_url && m.poster_url && m.attribution);
    assert.ok(!/trailer|teaser/i.test(m.title));
    assert.equal((await findMovie(m.slug))?.id, m.id);
    const episodes = await movieEpisodes(m.id);
    assert.equal(episodes.length, m.episodes?.length || 0);
    for (const e of episodes) {
      assert.equal(e.episode_number, episodes.indexOf(e) + 1);
      assert.ok(e.duration > 0);
    }
    for (const target of episodes.length ? episodes : [undefined]) {
      const result = await playback(m.id, target?.id);
      assert.ok(result.sources.length);
      for (const s of result.sources) {
        assert.ok(["MP4", "WEBM"].includes(s.protocol));
        assert.equal(s.mime_type, s.protocol === "WEBM" ? "video/webm" : "video/mp4");
        assert.ok(!urls.has(s.url), "Episode/source duplicate");
        urls.add(s.url);
      }
    }
  }
  const discover = await homeCatalog();
  assert.equal(discover.series.length, 3);
  assert.equal(discover.shortSeries.length, 4);
  assert.ok(Object.values(discover).every((items) => items.length <= 6));
  assert.equal((await searchCatalog({ q: "Judex" })).items[0].id, "judex-1916");
  assert.equal((await searchCatalog({ page: 2 })).items.length, 12);
});
test("favorites/history work for new movies and episodes; Admin can reorder without losing IDs or sources", async () => {
  await setFavorite("discovery-viewer", { movie_id: "judex-1916", active: true });
  assert.ok((await favoriteMovies("discovery-viewer")).some((m) => m.id === "judex-1916"));
  const eps = await movieEpisodes("judex-1916");
  await saveWatchProgress("discovery-viewer", {
    movie_id: "judex-1916",
    episode_id: eps[0].id,
    position_seconds: 17,
    duration_seconds: eps[0].duration,
  });
  const m = catalog.find((m) => m.id === "judex-1916"),
    editor = await movieEditorData("discovery-admin", m.id);
  const keys = [
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
  const input = {
    ...Object.fromEntries(keys.map((k) => [k, m[k]])),
    genres: editor.genres,
    episodes: editor.episodes,
  };
  const before = await playback(m.id, eps[0].id);
  input.episodes[0].description = "Texte de validation réservé à la base de test.";
  input.episodes[0].episode_number = 2;
  input.episodes[1].episode_number = 1;
  await saveMovie("discovery-admin", input, m.id);
  const reordered = await movieEpisodes(m.id);
  assert.equal(reordered[0].id, eps[1].id);
  assert.equal(reordered[1].id, eps[0].id);
  assert.equal(reordered[1].description, input.episodes[0].description);
  const legacy = {
    ...input,
    episodes: input.episodes.map(({ description, ...episode }) => episode),
  };
  await saveMovie("discovery-admin", legacy, m.id);
  assert.equal(
    (await movieEpisodes(m.id)).find((e) => e.id === eps[0].id)?.description,
    input.episodes[0].description,
  );
  const foreign = (await movieEpisodes("felix-the-cat"))[0];
  await assert.rejects(
    () =>
      saveMovie(
        "discovery-admin",
        { ...input, episodes: [{ ...input.episodes[0], id: foreign.id }] },
        m.id,
      ),
    /không thuộc phim/,
  );
  assert.deepEqual(await playback(m.id, eps[0].id), before);
  assert.equal((await history("discovery-viewer"))[0].position_seconds, 17);
  await assert.rejects(() => saveMovie("discovery-viewer", input, m.id));
});
test("public playback keeps required credits and excludes provider-only provenance", async () => {
  const source = (
    await db.query(
      "SELECT id,provenance FROM cinevjet.video_sources WHERE movie_id='spring' AND is_active LIMIT 1",
    )
  ).rows[0];
  try {
    await db.query(
      "UPDATE cinevjet.video_sources SET provenance=COALESCE(provenance,'{}'::jsonb)||$1::jsonb WHERE id=$2",
      [
        JSON.stringify({
          license_name: "CC BY 4.0",
          attribution: "Blender Studio",
          provider: "internal-provider",
          crawler: "internal",
          api_key: "test-only-not-a-secret",
        }),
        source.id,
      ],
    );
    const media = await playback("spring");
    const selected = media.sources.find((s) => s.id === source.id)!;
    assert.ok(selected.credit?.license_name);
    assert.ok(selected.credit?.attribution);
    assert.ok(!JSON.stringify(selected).includes("internal-provider"));
    assert.ok(!JSON.stringify(selected).includes("test-only-not-a-secret"));
  } finally {
    await db.query("UPDATE cinevjet.video_sources SET provenance=$1 WHERE id=$2", [
      source.provenance,
      source.id,
    ]);
  }
});
test.after(() => db.close());
