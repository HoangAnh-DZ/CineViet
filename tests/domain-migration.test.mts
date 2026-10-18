import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trustedOrigins, resolveRequestOrigin } from "../src/lib/domain-routing";
import { verifiedProductionOrigins } from "../scripts/production-origins.mjs";
import { configuredSiteOrigin, customProductionOrigin } from "../src/lib/site";
import { checkOrigin } from "../src/server/http";
import { paymentOrigin } from "../src/server/payos-client";
import { cookieOptions } from "../src/server/auth-core";
const domains = [
  "https://managed.example",
  "https://www.managed.example",
  "https://managed.vercel.app",
];
const config = {
  vercel: "1",
  deployment: "build-123.vercel.app",
  productionOrigins: JSON.stringify(domains),
};

test("registry accepts only verified domains assigned to the linked Production project", () => {
  const entry = { projectId: "project-qa", verified: true, redirect: null };
  const result = verifiedProductionOrigins(
    {
      domains: [
        { ...entry, name: "managed.example" },
        { ...entry, name: "www.managed.example" },
        { ...entry, name: "foreign.example", projectId: "other" },
        { ...entry, name: "unverified.example", verified: false },
        { ...entry, name: "preview.example", gitBranch: "preview" },
        { ...entry, name: "custom.example", customEnvironmentId: "staging" },
        { ...entry, name: "redirect.example", redirect: "managed.example" },
        { ...entry, name: "managed.example/evil" },
      ],
      pagination: { next: null },
    },
    "project-qa",
  );
  assert.deepEqual(result, domains.slice(0, 2));
  assert.throws(() =>
    verifiedProductionOrigins({ domains: [], pagination: { next: 123 } }, "project-qa"),
  );
});

test("exact origins reject wildcards, credentials, paths, HTTP, ports and malformed config", () => {
  const bad = [
    "*",
    "https://*.example",
    "https://managed.example/",
    "https://user@managed.example",
    "https://managed.example:444",
    "http://managed.example",
    "null",
    42,
  ];
  assert.deepEqual(
    trustedOrigins({ ...config, productionOrigins: JSON.stringify([...domains, ...bad]) }),
    [...domains, "https://build-123.vercel.app"],
  );
  assert.deepEqual(
    trustedOrigins({ vercel: "1", productionOrigins: "broken", appUrl: domains[0] }),
    [],
  );
});

test("validated host handles Next internal URL without trusting forwarded host or arbitrary Host", () => {
  for (const origin of domains) {
    assert.equal(
      resolveRequestOrigin(
        { url: "http://localhost:3000/api", headers: new Headers({ host: new URL(origin).host }) },
        config,
      ),
      origin,
    );
    assert.equal(
      resolveRequestOrigin(
        { url: origin + "/vip?next=//evil.invalid", headers: new Headers() },
        config,
      ),
      origin,
    );
  }
  for (const host of [
    "evil.example",
    "managed.example.evil.invalid",
    "managed.example:444",
    "managed.example,evil.example",
    "user@managed.example",
  ])
    assert.equal(
      resolveRequestOrigin(
        {
          url: domains[0] + "/api",
          headers: new Headers({ host, "x-forwarded-host": "managed.example" }),
        },
        config,
      ),
      null,
    );
  assert.equal(
    resolveRequestOrigin(
      {
        url: "https://evil.example/api",
        headers: new Headers({ "x-forwarded-host": "managed.example" }),
      },
      config,
    ),
    null,
  );
  assert.equal(
    resolveRequestOrigin({ url: "http://localhost:3017", headers: new Headers() }, { vercel: "1" }),
    null,
  );
  assert.equal(
    resolveRequestOrigin({ url: "http://localhost:3017", headers: new Headers() }, {}),
    "http://localhost:3017",
  );
});

test("CSRF requires same validated host even between two managed domains", () => {
  const saved = {
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,
    CINEVJET_PRODUCTION_ORIGINS: process.env.CINEVJET_PRODUCTION_ORIGINS,
  };
  Object.assign(process.env, {
    VERCEL: "1",
    VERCEL_URL: config.deployment,
    CINEVJET_PRODUCTION_ORIGINS: config.productionOrigins,
  });
  try {
    for (const origin of domains)
      assert.equal(
        checkOrigin(new Request(origin + "/api/auth/login", { headers: { origin } })),
        origin,
      );
    assert.throws(() =>
      checkOrigin(new Request(domains[0] + "/api/auth/login", { headers: { origin: domains[1] } })),
    );
    assert.throws(() => checkOrigin(new Request(domains[0] + "/api/auth/login")));
    assert.throws(() =>
      checkOrigin(
        new Request("https://evil.example/api", { headers: { origin: "https://evil.example" } }),
      ),
    );
  } finally {
    for (const [key, value] of Object.entries(saved))
      value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test("canonical SEO and stable webhook stay configured independently of the incoming domain", async () => {
  const old = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = customProductionOrigin;
    assert.equal(configuredSiteOrigin(), customProductionOrigin);
    assert.equal(paymentOrigin(), customProductionOrigin);
    const proxy = await readFile("next.config.ts", "utf8");
    assert.ok(!proxy.includes("redirects("));
    assert.equal(await readFile("src/proxy.ts", "utf8").catch(() => null), null);
  } finally {
    old === undefined
      ? delete process.env.NEXT_PUBLIC_APP_URL
      : (process.env.NEXT_PUBLIC_APP_URL = old);
  }
});

test("sessions remain host-only, HttpOnly, SameSite Lax and Secure in production", () => {
  assert.equal("domain" in cookieOptions, false);
  assert.equal(cookieOptions.path, "/");
  assert.equal(cookieOptions.httpOnly, true);
  assert.equal(cookieOptions.sameSite, "lax");
  assert.equal(cookieOptions.secure, process.env.NODE_ENV === "production");
});
