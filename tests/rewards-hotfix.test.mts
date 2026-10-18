import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readBody, failure } from "../src/server/http";
import { requestJson } from "../src/services/client";
const origin = "https://example.invalid";
const bodyRequest = (body: string) =>
  new Request(origin, { method: "POST", headers: { "Content-Type": "application/json" }, body });
test("legacy zero-byte check-in is accepted only with explicit opt-in; other endpoints stay strict", async () => {
  assert.deepEqual(
    z
      .object({})
      .strict()
      .parse(await readBody(bodyRequest(""), 8192, true)),
    {},
  );
  assert.deepEqual(await readBody(bodyRequest("{}"), 8192, true), {});
  await assert.rejects(readBody(bodyRequest("")), (e: any) => e.status === 400);
  for (const body of [
    " ",
    "{",
    "null",
    "[]",
    '{"calendar_date":"2040-01-01"}',
    '{"reward":999999,"balance":999999,"watched_seconds":999999}',
  ]) {
    await assert.rejects(async () =>
      z
        .object({})
        .strict()
        .parse(await readBody(bodyRequest(body), 8192, true)),
    );
  }
});
test("body size, content type and JSON errors keep a safe JSON response", async () => {
  for (const [req, status] of [
    [
      new Request(origin, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
      415,
    ],
    [bodyRequest("x".repeat(30)), 413],
    [bodyRequest("{"), 400],
  ] as const) {
    try {
      await readBody(req, 20, true);
      assert.fail("Invalid request accepted");
    } catch (e) {
      const r = failure(e);
      assert.equal(r.status, status);
      assert.match(r.headers.get("Content-Type")!, /application\/json/);
      assert.equal(typeof (await r.json()).error, "string");
    }
  }
});
test("HTTP client distinguishes expired sessions, HTML, empty/malformed JSON, safe API errors and valid JSON", async (t) => {
  const original = globalThis.fetch;
  try {
    for (const [name, response, expected] of [
      [
        "HTML",
        new Response("<html>PRIVATE RAW BODY</html>", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
        "Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau.",
      ],
      [
        "empty",
        new Response("", { headers: { "Content-Type": "application/json" } }),
        "Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau.",
      ],
      [
        "malformed",
        new Response("{", { headers: { "Content-Type": "application/json" } }),
        "Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau.",
      ],
      [
        "expired",
        new Response("<html>login</html>", { status: 401 }),
        "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      ],
      [
        "API error",
        Response.json({ error: "Điểm danh đang tạm dừng." }, { status: 403 }),
        "Điểm danh đang tạm dừng.",
      ],
      [
        "unsafe error",
        Response.json({ error: "<html>PRIVATE RAW BODY</html>" }, { status: 500 }),
        "Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau.",
      ],
    ] as const)
      await t.test(name, async () => {
        globalThis.fetch = async () => response;
        await assert.rejects(requestJson(origin), (e: any) => e.message === expected);
      });
    await t.test("login redirect", async () => {
      const r = new Response("<html>login</html>");
      Object.defineProperties(r, {
        redirected: { value: true },
        url: { value: origin + "/login?next=%2Frewards" },
      });
      globalThis.fetch = async () => r;
      await assert.rejects(requestJson(origin), /Phiên đăng nhập/);
    });
    await t.test("mutation response lost", async () => {
      globalThis.fetch = async () => {
        throw new TypeError("network");
      };
      await assert.rejects(
        requestJson(origin, { method: "POST", body: "{}" }),
        /Kiểm tra trạng thái trước khi thử lại/,
      );
    });
    await t.test("valid response", async () => {
      globalThis.fetch = async () => Response.json({ claimed_today: true });
      assert.deepEqual(await requestJson(origin), { claimed_today: true });
    });
    await t.test("incorrect login credentials keep the authentication error", async () => {
      globalThis.fetch = async () =>
        Response.json({ error: "Email hoặc mật khẩu không đúng." }, { status: 401 });
      await assert.rejects(
        requestJson("/api/auth/login", { method: "POST", body: "{}" }),
        /Email hoặc mật khẩu không đúng/,
      );
    });
  } finally {
    globalThis.fetch = original;
  }
});
