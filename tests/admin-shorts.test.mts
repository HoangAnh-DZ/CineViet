import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assertAdmin } from "../src/server/admin-core";
import { saveShort, setShortActive, deleteShort } from "../src/server/admin-shorts";
import { shortsFeed, adminShortsList } from "../src/server/shorts";
import {
  shortInput,
  safeMediaUrl,
  validUpload,
  MAX_UPLOAD_BYTES,
} from "../src/domain/short-validation";
import { validMediaSignature } from "../src/server/short-uploads";
import { checkOrigin } from "../src/server/http";
const pg = new PGlite();
for (const migration of (await readdir("database/migrations"))
  .filter((n) => n.endsWith(".sql"))
  .sort())
  await pg.exec(await readFile("database/migrations/" + migration, "utf8"));
await pg.exec(await readFile("database/seed.sql", "utf8"));
await pg.exec(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES('admin-test','admin@example.test','unused','Admin'),('regular-test','regular@example.test','unused','Regular'); INSERT INTO cinevjet.admin_users(user_id) VALUES('admin-test');",
);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pg,
) as unknown as NodePgDatabase;
const seed = await readFile("database/shorts-seed.sql", "utf8");
await pg.exec(seed);
const base = {
  title: "Independent short",
  description: "Test legal video",
  creator_name: "Tester",
  movie_id: null,
  episode_id: null,
  video_url: "https://example.test/video.mp4",
  thumbnail_url: null,
  duration_seconds: 6,
  hashtags: ["#test"],
  display_order: 20,
  is_active: true,
  source_type: "EXTERNAL" as const,
};
let id = "";
test("Admin Shorts database and security", async (t) => {
  await t.test("list includes five seeded records and seed preserves edits", async () => {
    assert.equal((await adminShortsList()).items.length, 5);
    await pg.exec(seed);
    assert.equal((await adminShortsList()).items.length, 5);
  });
  await t.test("create external URL persists a DB record", async () => {
    id = (await saveShort("admin-test", base)).id;
    assert.equal((await adminShortsList()).items.find((s) => s.id === id)?.title, base.title);
  });
  await t.test("edit metadata without reupload", async () => {
    await saveShort("admin-test", { ...base, title: "Edited", hashtags: ["#edited"] }, id);
    assert.equal(
      (await adminShortsList()).items.find((s) => s.id === id)?.video_url,
      base.video_url,
    );
  });
  await t.test("disable hides from public feed but remains in admin", async () => {
    await setShortActive("admin-test", id, false);
    assert.equal((await adminShortsList()).items.find((s) => s.id === id)?.is_active, false);
    assert.ok(!(await shortsFeed()).items.some((s) => s.id === id));
  });
  await t.test("enable restores active record", async () => {
    await setShortActive("admin-test", id, true);
    const first = await shortsFeed();
    assert.equal(first.items[0].id, id);
    assert.ok(first.items.every(s=>s.source_type!=="DEMO"));
  });
  await t.test("movie and episode relation verified with thumbnail fallback", async () => {
    const movie = (
      await pg.query<{ id: string; slug: string; poster_url: string }>(
        "SELECT id,slug,poster_url FROM cinevjet.movies ORDER BY id LIMIT 1",
      )
    ).rows[0];
    await saveShort("admin-test", { ...base, movie_id: movie.id }, id);
    const s = (await adminShortsList()).items.find((s) => s.id === id)!;
    assert.equal(s.movie_slug, movie.slug);
    assert.equal(s.thumbnail_url, movie.poster_url);
    assert.equal(s.stored_thumbnail_url, null);
    await assert.rejects(
      saveShort("admin-test", { ...base, movie_id: movie.id, episode_id: "missing" }, id),
    );
  });
  await t.test(
    "deterministic keyset pagination handles identical microsecond timestamps",
    async () => {
      for (let n = 0; n < 9; n++)
        await saveShort("admin-test", { ...base, display_order: -5, title: "Tie " + n });
      await pg.exec(
        "UPDATE cinevjet.short_videos SET created_at='2026-10-09T01:00:00.123456Z' WHERE display_order=-5",
      );
      const a = await shortsFeed(),
        b = await shortsFeed(a.nextCursor!);
      assert.equal(a.items.length, 5);
      assert.equal(b.items.length, 5);
      assert.equal(new Set([...a.items, ...b.items].map((s) => s.id)).size, 10);
      assert.ok(a.items.every((s) => s.title.startsWith("Tie")));
    },
  );
  await t.test("shared selected record opens in bounded batch", async () => {
    const b = await shortsFeed(undefined, id);
    assert.equal(b.items[0].id, id);
    assert.ok(b.items.length <= 5);
  });
  await t.test("invalid cursor rejected", async () => {
    for (const cursor of [
      "-1",
      "xxx",
      Buffer.from('{"order":1,"date":"bad","id":"x"}').toString("base64url"),
    ])
      await assert.rejects(shortsFeed(cursor), RangeError);
  });
  await t.test("soft delete keeps metadata and files, hides from list/feed", async () => {
    await deleteShort("admin-test", id);
    assert.ok(!(await adminShortsList()).items.some((s) => s.id === id));
    const row = (
      await pg.query<{ video_url: string; deleted_at: unknown; is_active: boolean }>(
        "SELECT video_url,deleted_at,is_active FROM cinevjet.short_videos WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.video_url, base.video_url);
    assert.ok(row.deleted_at);
    assert.equal(row.is_active, false);
  });
  await t.test("regular users blocked from every service mutation", async () => {
    for (const fn of [
      () => assertAdmin("regular-test"),
      () => saveShort("regular-test", base),
      () => saveShort("regular-test", base, id),
      () => setShortActive("regular-test", id, true),
      () => deleteShort("regular-test", id),
    ])
      await assert.rejects(fn(), (e: unknown) => (e as { status: number }).status === 403);
  });
  await t.test("URL schemes, credentials and local network targets rejected", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:video/mp4,test",
      "http://example.test/a.mp4",
      "https://user:password@example.test/a.mp4",
      "https://127.0.0.1/a.mp4",
      "https://192.168.1.2/a.mp4",
      "https://example.test/a.exe",
    ])
      assert.equal(safeMediaUrl(url, "video"), false);
    assert.ok(safeMediaUrl(base.video_url, "video"));
  });
  await t.test("upload MIME, extension, size and binary signatures checked", async () => {
    assert.ok(validUpload("video", "large.mp4", "video/mp4", MAX_UPLOAD_BYTES));
    assert.equal(validUpload("video", "a.mp4", "video/mp4", MAX_UPLOAD_BYTES + 1), false);
    for (const [name, mime, size] of [
      ["x.exe", "video/mp4", 10],
      ["x.mp4", "image/png", 10],
      ["x.mp4", "video/mp4", 0],
    ] as const)
      assert.equal(validUpload("video", name, mime, size), false);
    assert.ok(validMediaSignature("video/mp4", await readFile("public/video/shorts/bunny-1.mp4")));
    assert.equal(validMediaSignature("video/mp4", Buffer.from("MZ executable")), false);
    await assert.rejects(saveShort("admin-test", { ...base, source_type: "UPLOAD" }));
  });
  await t.test("validated uploaded media can persist and metadata remain editable", async () => {
    const url = "https://example.public.blob.vercel-storage.com/shorts/test.mp4";
    await pg.query(
      "INSERT INTO cinevjet.short_uploads(url,user_id,kind,content_type,size_bytes) VALUES($1,'admin-test','video','video/mp4',100)",
      [url],
    );
    const record = await saveShort("admin-test", {
      ...base,
      source_type: "UPLOAD",
      video_url: url,
    });
    await saveShort(
      "admin-test",
      { ...base, title: "Uploaded edit", source_type: "UPLOAD", video_url: url },
      record.id,
    );
    assert.equal(
      (await adminShortsList()).items.find((s) => s.id === record.id)?.title,
      "Uploaded edit",
    );
  });
  await t.test("required fields and same-origin writes enforced", () => {
    assert.equal(shortInput.safeParse({ ...base, title: " " }).success, false);
    process.env.NEXT_PUBLIC_APP_URL = "https://cinevjet.example";
    assert.throws(() =>
      checkOrigin(
        new Request("https://cinevjet.example/api/admin/shorts", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    );
  });
  await t.test("catalog and protected business records preserved", async () => {
    const r = (
      await pg.query<{ movies: number; episodes: number; users: number; money: number }>(
        "SELECT (SELECT count(*)::int FROM cinevjet.movies) movies,(SELECT count(*)::int FROM cinevjet.episodes) episodes,(SELECT count(*)::int FROM cinevjet.users) users,(SELECT count(*)::int FROM cinevjet.coin_ledger) money",
      )
    ).rows[0];
    assert.deepEqual(r, { movies: 12, episodes: 40, users: 2, money: 0 });
  });
});
test.after(async () => {
  await pg.close();
});
