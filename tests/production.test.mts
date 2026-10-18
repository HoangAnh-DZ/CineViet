import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import {
  register,
  login,
  resolveSession,
  invalidateSession,
  throttleAuth,
  throttleRegistration,
  registrationEmailIdentity,
  cookieOptions,
} from "../src/server/auth-core";
import {
  homeCatalog,
  searchCatalog,
  findMovie,
  movieEpisodes,
  playback,
} from "../src/server/catalog";
import {
  balances,
  entitlements,
  favoriteMovies,
  history,
  saveWatchProgress,
  setFavorite,
} from "../src/server/account";
import { checkOrigin } from "../src/server/http";
import { registrationSchema } from "../src/server/validation";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
process.env.AUTH_SECRET = "test-secret-only-never-use-in-production-123";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
const postgres = new PGlite();
for (const migration of (await readdir("database/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  await postgres.exec(await readFile("database/migrations/" + migration, "utf8"));
}
await postgres.exec(await readFile("database/seed.sql", "utf8"));
const db = drizzle(postgres);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
  db as unknown as NodePgDatabase;
const credentials = {
  email: "  TEST@Example.com  ",
  password: "Strong-test-123",
  display_name: "Tester",
  remember: true,
};
let account: Awaited<ReturnType<typeof register>>;
const loginCredentials = {
  email: credentials.email,
  password: credentials.password,
  remember: credentials.remember,
};
test("production repositories on isolated PostgreSQL", async (t) => {
  await t.test("schema and seed contain 12 movies, 40 episodes, no users or money", async () => {
    const counts = await postgres.query<{
      movies: number;
      episodes: number;
      users: number;
      deposits: number;
    }>(
      "SELECT (SELECT count(*)::int FROM cinevjet.movies) movies,(SELECT count(*)::int FROM cinevjet.episodes) episodes,(SELECT count(*)::int FROM cinevjet.users) users,(SELECT count(*)::int FROM cinevjet.deposits) deposits",
    );
    assert.deepEqual(counts.rows[0], { movies: 12, episodes: 40, users: 0, deposits: 0 });
  });
  await t.test("seed is idempotent", async () => {
    await postgres.exec(await readFile("database/seed.sql", "utf8"));
    assert.equal((await searchCatalog({})).total, 12);
  });
  await t.test(
    "register normalizes email, hashes password and initializes zero wallets atomically",
    async () => {
      account = await register(credentials);
      assert.equal(account.user.email, "test@example.com");
      const row = (
        await postgres.query<{ password_hash: string }>(
          "SELECT password_hash FROM cinevjet.users WHERE id=$1",
          [account.user.id],
        )
      ).rows[0];
      assert.match(row.password_hash, /^\$2[aby]\$12\$/);
      assert.notEqual(row.password_hash, credentials.password);
      assert.deepEqual(await balances(account.user.id), {
        cash: 0,
        available: 0,
        coins: 0,
        coins_total: 0,
        coins_reserved: 0,
      });
    },
  );
  await t.test("duplicate email is rejected without creating another account", async () => {
    await assert.rejects(register(credentials), /Email đã/);
    assert.equal(
      (await postgres.query<{ count: number }>("SELECT count(*)::int FROM cinevjet.users")).rows[0]
        .count,
      1,
    );
  });
  await t.test("validation rejects short passwords and bcrypt byte truncation", () => {
    assert.equal(
      registrationSchema.safeParse({ ...credentials, password: "short" }).success,
      false,
    );
    assert.equal(
      registrationSchema.safeParse({ ...credentials, password: "đ".repeat(40) }).success,
      false,
    );
  });
  await t.test(
    "session tokens are hashed, resolve after reload, cookies are HttpOnly SameSite",
    async () => {
      assert.equal((await resolveSession(account.session.token))?.id, account.user.id);
      const row = (
        await postgres.query<{ token_hash: string }>(
          "SELECT token_hash FROM cinevjet.sessions WHERE id=$1",
          [account.session.id],
        )
      ).rows[0];
      assert.notEqual(row.token_hash, account.session.token);
      assert.equal(cookieOptions.httpOnly, true);
      assert.equal(cookieOptions.sameSite, "lax");
    },
  );
  await t.test("login works; wrong password fails", async () => {
    const valid = await login(loginCredentials);
    assert.equal(valid.user.id, account.user.id);
    await assert.rejects(login({ ...loginCredentials, password: "wrong-password" }), /không đúng/);
  });
  await t.test("expired session and suspended user cannot authenticate", async () => {
    await postgres.query(
      "UPDATE cinevjet.sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
      [account.session.id],
    );
    assert.equal(await resolveSession(account.session.token), null);
    account = await login(loginCredentials);
    await postgres.query("UPDATE cinevjet.users SET status='SUSPENDED' WHERE id=$1", [
      account.user.id,
    ]);
    assert.equal(await resolveSession(account.session.token), null);
    await postgres.query("UPDATE cinevjet.users SET status='ACTIVE' WHERE id=$1", [
      account.user.id,
    ]);
  });
  await t.test("logout invalidates existing session; forged token rejected", async () => {
    await invalidateSession(account.session.token);
    assert.equal(await resolveSession(account.session.token), null);
    assert.equal(await resolveSession("forged"), null);
  });
  await t.test("auth attempts are limited durably", async () => {
    await throttleAuth("test-limiter", 1);
    await assert.rejects(throttleAuth("test-limiter", 1), /Quá nhiều/);
  });
  await t.test(
    "Gmail aliases cannot create extra accounts; original login remains valid",
    async () => {
      const original = { ...credentials, email: "qa.alias@gmail.com" };
      const gmailAccount = await register(original);
      for (const email of [
        "qaalias@gmail.com",
        "qa.alias+bonus@gmail.com",
        "qaalias@googlemail.com",
      ]) {
        await assert.rejects(register({ ...original, email }), /Email đã được sử dụng/);
      }
      assert.equal(
        (await login({ ...loginCredentials, email: original.email })).user.id,
        gmailAccount.user.id,
      );
      assert.equal(
        (await login({ ...loginCredentials, email: original.email })).user.email,
        "qa.alias@gmail.com",
      );
      assert.equal(
        (
          await postgres.query<{ count: number }>(
            "SELECT count(*)::int FROM cinevjet.users WHERE email LIKE '%gmail.com' OR email LIKE '%googlemail.com'",
          )
        ).rows[0].count,
        1,
      );
      assert.equal(registrationEmailIdentity(" QA.Alias+bonus@GMAIL.COM "), "qaalias@gmail.com");
      assert.equal(
        registrationEmailIdentity("qa.alias+bonus@company.com"),
        "qa.alias+bonus@company.com",
      );
    },
  );
  await t.test("registration email aliases share a strict limit across different IPs", async () => {
    for (let i = 0; i < 3; i++) {
      await throttleRegistration(`limit.email+${i}@gmail.com`, `email-limit-ip-${i}`);
    }
    await assert.rejects(throttleRegistration("limitemail@googlemail.com", "another-ip"), /1 giờ/);
  });
  await t.test(
    "registration IP cap applies across email addresses and does not block login",
    async () => {
      for (let i = 0; i < 5; i++) {
        await throttleRegistration(`ip-limit-${i}@example.com`, "registration-limit-ip");
      }
      await assert.rejects(
        throttleRegistration("ip-limit-next@example.com", "registration-limit-ip"),
        /1 giờ/,
      );
      await throttleAuth("ip:registration-limit-ip", 60);
      assert.equal((await login(loginCredentials)).user.id, account.user.id);
    },
  );
  await t.test(
    "expired hourly registration cap resets while daily cap remains enforced",
    async () => {
      for (let i = 0; i < 5; i++) {
        await throttleRegistration(`daily-first-${i}@example.com`, "registration-daily-ip");
      }
      await postgres.exec(
        "UPDATE cinevjet.auth_limits SET window_start=now()-interval '61 minutes' WHERE attempts=5",
      );
      for (let i = 0; i < 5; i++) {
        await throttleRegistration(`daily-second-${i}@example.com`, "registration-daily-ip");
      }
      await postgres.exec(
        "UPDATE cinevjet.auth_limits SET window_start=now()-interval '61 minutes' WHERE attempts=5",
      );
      await assert.rejects(
        throttleRegistration("daily-next@example.com", "registration-daily-ip"),
        /24 giờ/,
      );
    },
  );
  await t.test("cross-origin and absent-origin mutations rejected", () => {
    assert.throws(() =>
      checkOrigin(
        new Request("http://localhost:3000/api/progress", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    );
    assert.throws(() => checkOrigin(new Request("http://localhost:3000/api/progress")));
    checkOrigin(
      new Request("http://localhost:3000/api/progress", {
        headers: { origin: "http://localhost:3000" },
      }),
    );
  });
  await t.test(
    "verified project aliases and current deployment work; foreign origins stay blocked",
    () => {
      const oldVercel = process.env.VERCEL;
      const oldOrigins = process.env.CINEVJET_PRODUCTION_ORIGINS;
      const oldUrl = process.env.VERCEL_URL;
      process.env.VERCEL = "1";
      const aliases = [
        "https://cine-vjet.cyou",
        "https://www.cine-vjet.cyou",
        "https://cinevjet.vercel.app",
      ];
      process.env.CINEVJET_PRODUCTION_ORIGINS = JSON.stringify(aliases);
      process.env.VERCEL_URL = "cinevjet-qa-test.vercel.app";
      try {
        checkOrigin(
          new Request("https://cinevjet-qa-test.vercel.app/api/auth/register-check", {
            headers: { origin: "https://cinevjet-qa-test.vercel.app" },
          }),
        );
        for (const origin of aliases) {
          for (const action of ["login", "register", "register-check", "register-code", "logout"]) {
            checkOrigin(new Request(`${origin}/api/auth/${action}`, { headers: { origin } }));
          }
        }
        for (const origin of [
          "null",
          "https://cine-vjet.cyou.attacker.invalid",
          "https://attacker.cine-vjet.cyou",
          "http://cine-vjet.cyou",
          "https://cine-vjet.cyou:444",
          "https://cinevjet.cyou.attacker.invalid",
          "https://attacker.cinevjet.cyou",
          "http://cinevjet.cyou",
          "https://cinevjet.cyou:444",
          "https://attacker.vercel.app",
          "http://cinevjet.vercel.app",
          "https://cinevjet.vercel.app.attacker.invalid",
          "https://cinevjet.vercel.app:444",
        ]) {
          assert.throws(() =>
            checkOrigin(
              new Request("https://cinevjet.vercel.app/api/auth/login", {
                headers: {
                  origin,
                  host: "cinevjet.vercel.app",
                  "x-forwarded-host": "cinevjet.vercel.app",
                },
              }),
            ),
          );
        }
        assert.throws(() => checkOrigin(new Request("https://cinevjet.vercel.app/api/auth/login")));
        assert.throws(() =>
          checkOrigin(
            new Request("https://cinevjet-qa-test.vercel.app/api/auth/register-check", {
              headers: {
                origin: "https://attacker.vercel.app",
                host: "attacker.vercel.app",
                "x-forwarded-host": "attacker.vercel.app",
              },
            }),
          ),
        );
      } finally {
        if (oldOrigins === undefined) delete process.env.CINEVJET_PRODUCTION_ORIGINS;
        else process.env.CINEVJET_PRODUCTION_ORIGINS = oldOrigins;
        if (oldVercel === undefined) delete process.env.VERCEL;
        else process.env.VERCEL = oldVercel;
        if (oldUrl === undefined) delete process.env.VERCEL_URL;
        else process.env.VERCEL_URL = oldUrl;
      }
    },
  );
  await t.test("home sections query published database catalog", async () => {
    const home = await homeCatalog();
    assert.equal(home.featured.length, 3);
    assert.ok(home.series.every((m) => m.type === "SERIES"));
    assert.ok(home.featured[0].genres.length > 0);
  });
  await t.test(
    "search, genre, type, country and year filter on server; injection stays data",
    async () => {
      assert.equal((await searchCatalog({ q: "Desert" })).items[0].id, "desert-heir");
      assert.ok(
        (await searchCatalog({ genre: "Hoạt hình" })).items.every((m) =>
          m.genres.includes("Hoạt hình"),
        ),
      );
      assert.equal((await searchCatalog({ type: "SERIES" })).total, 4);
      assert.equal((await searchCatalog({ country: "Việt Nam", year: "2025" })).total, 1);
      assert.equal((await searchCatalog({ q: "' OR true --" })).total, 0);
    },
  );
  await t.test("pagination is bounded and deterministic", async () => {
    const result = await searchCatalog({ page: 2 });
    assert.equal(result.items.length, 0);
    assert.equal(result.pageSize, 12);
    await assert.rejects(searchCatalog({ page: -1 }));
  });
  await t.test("hidden and missing movies are excluded from catalog/detail", async () => {
    await postgres.query("UPDATE cinevjet.movies SET status='HIDDEN' WHERE id='silent-orbit'");
    assert.equal(await findMovie("silent-orbit"), null);
    assert.equal(await findMovie("missing"), null);
    assert.equal((await searchCatalog({})).total, 11);
  });
  await t.test("episodes and media come from database", async () => {
    const episodes = await movieEpisodes("desert-heir");
    assert.equal(episodes.length, 10);
    const media = await playback("desert-heir", episodes[0].id);
    assert.equal(media.sources[0].protocol, "MP4");
    assert.equal(media.subtitles[0].format, "VTT");
  });
  await t.test("favorites are unique, isolated between users and removable", async () => {
    await setFavorite(account.user.id, { movie_id: "midnight-rain", active: true });
    await setFavorite(account.user.id, { movie_id: "midnight-rain", active: true });
    assert.equal((await favoriteMovies(account.user.id)).length, 1);
    assert.equal((await favoriteMovies("other-user")).length, 0);
    await setFavorite(account.user.id, { movie_id: "midnight-rain", active: false });
    assert.equal((await favoriteMovies(account.user.id)).length, 0);
  });
  await t.test("watch progress upserts nullable episode key and joins continue data", async () => {
    const p = { movie_id: "midnight-rain", position_seconds: 20, duration_seconds: 60 };
    await saveWatchProgress(account.user.id, p);
    await saveWatchProgress(account.user.id, { ...p, position_seconds: 30 });
    const items = await history(account.user.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].position_seconds, 30);
    assert.equal(items[0].movie?.title, "Mật Mã Đêm Mưa");
    assert.equal((await history("other-user")).length, 0);
  });
  await t.test("invalid progress and cross-movie episode are rejected", async () => {
    await assert.rejects(
      saveWatchProgress(account.user.id, {
        movie_id: "midnight-rain",
        position_seconds: -1,
        duration_seconds: 60,
      }),
    );
    await assert.rejects(
      saveWatchProgress(account.user.id, {
        movie_id: "midnight-rain",
        position_seconds: 61,
        duration_seconds: 60,
      }),
    );
    await assert.rejects(
      saveWatchProgress(account.user.id, {
        movie_id: "desert-heir",
        episode_id: "last-forest-ep-1",
        position_seconds: 3,
        duration_seconds: 60,
      }),
    );
  });
  await t.test("completed episodes saved; history sorted newest first", async () => {
    await saveWatchProgress(account.user.id, {
      movie_id: "desert-heir",
      episode_id: "desert-heir-ep-1",
      position_seconds: 59,
      duration_seconds: 60,
    });
    const items = await history(account.user.id);
    assert.equal(items[0].episode_number, 1);
    assert.equal(items[0].completed, true);
    assert.equal(items.length, 2);
  });
  await t.test("VIP requires live server subscription; expired VIP is denied", async () => {
    assert.deepEqual(await entitlements(account.user.id), []);
    await assert.rejects(
      saveWatchProgress(account.user.id, {
        movie_id: "red-frontier",
        position_seconds: 3,
        duration_seconds: 60,
      }),
      /VIP/,
    );
    await db.execute(
      sql`INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,started_at,expires_at,status) VALUES('test-vip',${account.user.id},'VIP_MONTHLY',now()-interval '2 days',now()-interval '1 day','ACTIVE')`,
    );
    assert.deepEqual(await entitlements(account.user.id), []);
  });
  await t.test(
    "daily check-in unique date and wallet integer/nonnegative constraints",
    async () => {
      await postgres.query(
        "INSERT INTO cinevjet.daily_checkins(id,user_id,checkin_date,reward) VALUES('check1',$1,'2026-10-07',10)",
        [account.user.id],
      );
      await assert.rejects(
        postgres.query(
          "INSERT INTO cinevjet.daily_checkins(id,user_id,checkin_date,reward) VALUES('check2',$1,'2026-10-07',10)",
          [account.user.id],
        ),
      );
      await assert.rejects(
        postgres.query("UPDATE cinevjet.wallets SET balance=-1 WHERE user_id=$1", [
          account.user.id,
        ]),
      );
    },
  );
  await postgres.close();
});
