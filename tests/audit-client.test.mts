import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../src/services/client";

test("JSON reads have a deadline, preserve cancellation and do not retry", async (t) => {
  let calls = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    calls++;
    assert.ok(options.signal);
    assert.notEqual(options.signal, controller.signal);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw new DOMException("Aborted", "AbortError");
  });
  await assert.rejects(requestJson("/api/catalog", { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
});
test("HTML gateway failures show a safe actionable message, not parser text", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>private provider error</html>", { status: 503 }),
  );
  await assert.rejects(requestJson("/api/catalog"), /Dịch vụ tạm thời gián đoạn/);
});
test("mutations keep caller-controlled lifetime and advise checking status after ambiguous response", async (t) => {
  let calls = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    calls++;
    assert.equal(options.signal, controller.signal);
    return new Response("upstream failure", { status: 502 });
  });
  await assert.rejects(
    requestJson("/api/payments/payos", { method: "POST", signal: controller.signal }),
    /Kiểm tra trạng thái/,
  );
  assert.equal(calls, 1);
});
test("JSON server validation errors stay readable", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Số tiền không hợp lệ." }, { status: 400 }),
  );
  await assert.rejects(requestJson("/api/money", { method: "POST" }), /Số tiền không hợp lệ/);
});
