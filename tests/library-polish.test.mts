import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import type { CheckInDay } from "../src/domain/models";
// Node SSR tests do not process stylesheets; Next verifies their actual CSS in the browser/build.
createRequire(import.meta.url).extensions[".css"] = () => {};
Object.assign(globalThis, { React });
const { DailyCheckIn } = await import("../src/features/rewards/rewards-screen");
const { Coin } = await import("../src/components/ui");
const days: CheckInDay[] = [
  { day: 1, reward: 200, status: "CLAIMED" },
  { day: 2, reward: 300, status: "AVAILABLE" },
  { day: 3, reward: 500, status: "LOCKED" },
];
function render(pending: boolean) {
  return renderToStaticMarkup(
    createElement(DailyCheckIn, {
      days,
      calendarDate: "2026-10-09",
      pending,
      enabled: true,
      onClaim() {},
    }),
  );
}
test("check-in presentation preserves amounts and each actual day state", () => {
  const html = render(false);
  for (const label of [
    "Ngày 1, 200 xu, đã nhận",
    "Ngày 2, 300 xu, có thể nhận",
    "Ngày 3, 500 xu, chưa mở",
  ])
    assert.ok(html.includes(label));
  assert.ok(html.includes("Nhận +300 xu"));
});
test("pending claim exposes busy status and prevents repeat submission", () => {
  const html = render(true);
  assert.match(html, /aria-busy="true" disabled=""/);
  assert.ok(html.includes("Đang nhận xu…"));
});
test("claimed cycle stays disabled with honest status", () => {
  const html = renderToStaticMarkup(
    createElement(DailyCheckIn, {
      days: days.map((day) => ({ ...day, status: "CLAIMED" as const })),
      calendarDate: "2026-10-09",
      pending: false,
      enabled: true,
      onClaim() {},
    }),
  );
  assert.match(html, /aria-busy="false" disabled=""/);
  assert.ok(html.includes("Đã điểm danh hôm nay"));
});
test("large and small coins use one consistent satin asset without exposed decorative text", () => {
  for (const small of [false, true]) {
    const html = renderToStaticMarkup(createElement(Coin, { small }));
    assert.ok(html.includes("/images/reward-coin-satin.webp"));
    assert.ok(html.includes('aria-hidden="true"'));
    assert.ok(html.includes('alt=""'));
  }
});
