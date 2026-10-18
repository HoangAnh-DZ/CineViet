import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  importCatalog,
  protectedFingerprint,
  demoIds,
} from "../scripts/import-licensed-catalog.mjs";
import {
  searchCatalog,
  findMovie,
  movieEpisodes,
  playback,
  catalogOptions,
  homeCatalog,
  publicMoviePages,
} from "../src/server/catalog";
import { favoriteMovies, history, saveWatchProgress, setFavorite } from "../src/server/account";
import { saveMovie, movieEditorData } from "../src/server/dashboard";
import { movieInput } from "../src/domain/movie-management";
const db = new PGlite();
for (const name of (await readdir("database/migrations"))
  .filter((n) => n.endsWith(".sql") && !n.startsWith("0014"))
  .sort())
  await db.exec(await readFile("database/migrations/" + name, "utf8"));
await db.exec(await readFile("database/seed.sql", "utf8"));
await db.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('catalog-admin','admin@catalog.test','unused','Admin'),('catalog-viewer','viewer@catalog.test','unused','Viewer'); INSERT INTO cinevjet.admin_users(user_id) VALUES('catalog-admin'); INSERT INTO cinevjet.favorites(user_id,movie_id) VALUES('catalog-viewer','midnight-rain'); INSERT INTO cinevjet.watch_history(id,user_id,movie_id,position_seconds,duration_seconds) VALUES('old-progress','catalog-viewer','midnight-rain',20,120); INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES('catalog-viewer',123); INSERT INTO cinevjet.wallets(user_id,balance) VALUES('catalog-viewer',50000)",
);
const before = await protectedFingerprint(db);
await db.exec(await readFile("database/migrations/0014_licensed_movie_catalog.sql", "utf8"));
const catalog = JSON.parse(await readFile("database/licensed-catalog.json", "utf8"));
let queryCount = 0;
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  db,
  {
    logger: {
      logQuery() {
        queryCount++;
      },
    },
  },
) as unknown as NodePgDatabase;
test("migration and catalog replacement preserve all non-catalog data and old references", async () => {
  await db.exec("BEGIN");
  await importCatalog(db, catalog);
  await db.exec("COMMIT");
  assert.deepEqual(await protectedFingerprint(db), before);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM cinevjet.movies WHERE is_demo AND status='HIDDEN'",
      )
    ).rows[0].n,
    demoIds.length,
  );
  assert.equal((await db.query("SELECT count(*)::int n FROM cinevjet.episodes")).rows[0].n, 40);
  const snapshot = await protectedFingerprint(db);
  await importCatalog(db, catalog);
  assert.deepEqual(await protectedFingerprint(db), snapshot);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM cinevjet.video_sources WHERE provider='BLENDER_OFFICIAL'",
      )
    ).rows[0].n,
    8,
  );
});
test("real catalog, rights, sources, search and categories are consistent", async () => {
  const result = await searchCatalog({});
  assert.equal(result.total, 8);
  for (const m of result.items) {
    assert.equal(m.type, "MOVIE");
    assert.equal(m.rating, null);
    assert.ok(m.duration_seconds! > 0);
    assert.ok(m.license_name && m.attribution && m.poster_attribution && m.language);
    assert.ok(m.license_source_url!.startsWith("https://"));
    assert.ok((await readFile("public" + m.poster)).length > 5000);
    assert.equal((await movieEpisodes(m.id)).length, 0);
    const media = await playback(m.id);
    assert.equal(media.sources.length, 1);
    assert.equal(media.subtitles.length, 0);
    assert.match(
      media.sources[0].url,
      /^https:\/\/video\.blender\.org\/object-storage\/web_videos\/.+\.mp4$/,
    );
    assert.equal((await findMovie(m.slug))?.id, m.id);
  }
  assert.equal(await findMovie("desert-heir"), null);
  assert.equal((await searchCatalog({ q: "Spring" })).items[0].id, "spring");
  assert.equal((await searchCatalog({ genre: "Hoạt hình" })).total, 7);
  const options = await catalogOptions();
  assert.deepEqual(options.countries, ["Hà Lan"]);
  assert.ok(options.genres.includes("Hoạt hình"));
  const pages = await publicMoviePages();
  assert.equal(pages.length, 8);
  assert.ok(pages.every((p) => !Number.isNaN(p.updatedAt.getTime()) && !demoIds.includes(p.slug)));
});
test("favorites and resume save real films without deleting archived history", async () => {
  await setFavorite("catalog-viewer", { movie_id: "spring", active: true });
  await saveWatchProgress("catalog-viewer", {
    movie_id: "spring",
    position_seconds: 34,
    duration_seconds: 464,
  });
  assert.deepEqual(
    (await favoriteMovies("catalog-viewer")).map((m) => m.id),
    ["spring"],
  );
  assert.equal((await history("catalog-viewer"))[0].position_seconds, 34);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM cinevjet.watch_history WHERE id='old-progress'"))
      .rows[0].n,
    1,
  );
});
test("explore request query budget preserves featured ordering and published filters", async () => {
  queryCount = 0;
  const [home, options, search] = await Promise.all([
    homeCatalog(),
    catalogOptions(),
    searchCatalog({}),
  ]);
  console.log("EXPLORE_SQL_READS", queryCount);
  assert.equal(queryCount, 8);
  assert.deepEqual(home.featured, home.trending.slice(0, 3));
  assert.equal(search.total, 8);
  assert.deepEqual(
    options.years,
    [...new Set(search.items.map((m) => m.release_year))].sort((a, b) => b - a),
  );
  for (const rows of Object.values(home))
    assert.ok(rows.every((m) => m.status === "PUBLISHED" && !demoIds.includes(m.id)));
});
const film = movieInput.parse(
  Object.fromEntries(
    Object.entries(catalog[0]).filter(
      ([k]) =>
        !["id", "verified_at", "source_api_url", "stream_permission", "quality", "format"].includes(
          k,
        ),
    ),
  ),
);
test("publishing requires content rights, valid media and Admin access", async () => {
  assert.equal(movieInput.safeParse({ ...film, license_source_url: "" }).success, false);
  assert.equal(
    movieInput.safeParse({ ...film, playback_url: "https://example.com/trailer.html" }).success,
    false,
  );
  await assert.rejects(() => saveMovie("catalog-viewer", film));
  await assert.rejects(() => movieEditorData("catalog-viewer", "spring"));
});
test("existing admin supports licensed series, real episodes, editing and hiding without losing history", async () => {
  const input = {
    ...film,
    slug: "licensed-test-series",
    title: "Test series",
    type: "SERIES" as const,
    playback_url: "",
    episodes: [
      {
        season: 1,
        episode_number: 1,
        title: "Licensed episode",
        duration_seconds: 596,
        status: "PUBLISHED" as const,
        playback_url: film.playback_url!,
      },
    ],
  };
  const { id } = await saveMovie("catalog-admin", input);
  const detail = await movieEditorData("catalog-admin", id);
  assert.equal(detail.episodes.length, 1);
  assert.deepEqual(detail.genres, film.genres!.sort());
  const episode = detail.episodes[0] as (typeof input.episodes)[0] & { id: string };
  const source = await playback(id, episode.id);
  assert.equal(source.sources[0].url, film.playback_url);
  await saveWatchProgress("catalog-viewer", {
    movie_id: id,
    episode_id: episode.id,
    position_seconds: 12,
    duration_seconds: 596,
  });
  await saveMovie(
    "catalog-admin",
    { ...input, status: "HIDDEN", episodes: [{ ...episode, title: "Updated", status: "HIDDEN" }] },
    id,
  );
  assert.equal((await movieEpisodes(id)).length, 0);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM cinevjet.watch_history WHERE movie_id=$1", [id]))
      .rows[0].n,
    1,
  );
  assert.equal(
    movieInput.safeParse({ ...input, episodes: [...input.episodes, ...input.episodes] }).success,
    false,
  );
  assert.equal(
    movieInput.safeParse({ ...input, episodes: [{ ...input.episodes[0], playback_url: "" }] })
      .success,
    false,
  );
});
test.after(() => db.close());
