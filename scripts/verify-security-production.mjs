import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { artifactFindings } from "./verify-security-artifacts.mjs";

const origins = [
  "https://cine-vjet.cyou",
  "https://www.cine-vjet.cyou",
  "https://cinevjet-hoanganh-dz.vercel.app",
  "https://cinevjet.vercel.app",
];
const checks = [],
  chunks = new Set();
async function request(origin, path, method = "GET", body, headers = {}) {
  return fetch(origin + path, {
    method,
    redirect: "manual",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
}
function record(origin, path, status) {
  checks.push({ origin, path, status });
}
for (const origin of origins) {
  for (const path of [
    "/explore",
    "/login",
    "/register",
    "/vip",
    "/api/auth/session",
    "/api/catalog",
    "/api/money/config",
  ]) {
    const r = await request(origin, path);
    assert.equal(r.status, 200, origin + path);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.ok(r.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.ok(!r.headers.get("x-powered-by"));
    assert.ok(!r.headers.get("location"));
    const body = await r.text();
    if (path === "/api/auth/session") assert.deepEqual(JSON.parse(body), { user: null });
    if (path === "/api/catalog") assert.ok(JSON.parse(body).items.length > 0);
    if (origin === origins[0] && !path.startsWith("/api/"))
      for (const m of body.matchAll(/src="(\/_next\/static\/[^"?]+\.js)"/g)) chunks.add(m[1]);
    record(origin, path, r.status);
  }
  for (const path of [
    "/api/account",
    "/api/admin/users",
    "/api/rewards",
    "/api/payments/payos?plan_id=VIP_1",
  ]) {
    const r = await request(origin, path, "GET", undefined, {
      Cookie: `__Host-cinevjet_session=${randomBytes(32).toString("base64url")}`,
    });
    if (path === "/api/account") {
      assert.equal(r.status, 200, origin + path);
      assert.deepEqual(await r.json(), {
        user: null,
        favoriteMovies: [],
        progress: [],
        balance: { cash: 0, available: 0, coins: 0 },
        entitlements: [],
        savedShortIds: [],
      });
    } else {
      assert.equal(r.status, 401, origin + path);
      await r.arrayBuffer();
    }
    record(origin, path, r.status);
  }
  for (const path of ["/profile", "/rewards", "/rewards/redeem"]) {
    const r = await request(origin, path);
    if (r.status === 200) {
      // Next.js may flush the shell before auth resolves, then stream a redirect.
      const html = await r.text();
      assert.ok(
        html.includes('id="__next-page-redirect"') && html.includes('content="1;url=/login"'),
      );
      assert.ok(html.includes("NEXT_REDIRECT;replace;/login;307;"));
    } else {
      assert.ok([302, 303, 307, 308].includes(r.status));
      const location = new URL(r.headers.get("location"), origin);
      assert.equal(location.origin, origin);
      assert.equal(location.pathname, "/login");
    }
    record(origin, path, r.status);
  }
}
const origin = origins[0];
const signature = await request(origin, "/api/payments/payos/webhook", "POST", {
  code: "00",
  success: true,
  signature: "0".repeat(64),
  data: { orderCode: 1, amount: 1 },
});
assert.equal(signature.status, 401);
record(origin, "invalid-webhook-signature", signature.status);
await signature.arrayBuffer();
const csrf = await request(origin, "/api/account", "PATCH", {}, { Origin: "https://evil.invalid" });
assert.equal(csrf.status, 403);
record(origin, "cross-origin-write", csrf.status);
for (const path of ["/api/internal/finance-worker", "/api/internal/shorts-sync"]) {
  const r = await request(origin, path);
  assert.equal(r.status, 401);
  record(origin, path, r.status);
}
const legacy = await request(origin, "/api/demo/payments", "POST", {});
assert.equal(legacy.status, 410);
record(origin, "/api/demo/payments", legacy.status);
for (const path of chunks) {
  const r = await request(origin, path);
  assert.equal(r.status, 200);
  assert.deepEqual(artifactFindings(await r.text()), []);
  record(origin, path, r.status);
}
for (const path of [...chunks].slice(0, 3)) {
  const r = await request(origin, path + ".map");
  // The platform may deny source-map probes before Next.js returns its 404.
  assert.ok([403, 404].includes(r.status));
  const body = await r.text();
  assert.ok(!/"sources"\s*:/.test(body) && !/"mappings"\s*:/.test(body));
  record(origin, path + ".map", r.status);
}
await writeFile(
  ".vercel/security-production-smoke.json",
  JSON.stringify(
    {
      status: "PASS",
      checks: checks.length,
      domains: origins.length,
      publicClientChunks: chunks.size,
      financialWrites: 0,
      realUserChanges: 0,
      results: checks,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    runtime: "PASS",
    checks: checks.length,
    domains: origins.length,
    publicClientChunks: chunks.size,
    financialWrites: 0,
    realUserChanges: 0,
  }),
);
