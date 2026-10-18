import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyMissions } from "../src/features/rewards/daily-missions";
import type { DailyMissionsState } from "../src/domain/models";
Object.assign(globalThis, { React });
const data: DailyMissionsState = {
  calendar_date: "2026-12-11",
  timezone: "Asia/Ho_Chi_Minh",
  missions: [
    { id: "VIP_1_TASK_01", target_seconds: 30, watched_seconds: 30, reward: 100, status: "AVAILABLE" },
    {
      id: "VIP_1_TASK_02",
      target_seconds: 60,
      watched_seconds: 30,
      reward: 200,
      status: "IN_PROGRESS",
    },
    { id: "VIP_1_TASK_03", target_seconds: 90, watched_seconds: 90, reward: 400, status: "CLAIMED" },
  ],
};
test("mission cards render verified progress and all three real states", () => {
  const h = renderToStaticMarkup(
    React.createElement(DailyMissions, { data, pending: "", onClaim() {} }),
  );
  for (const s of [
    "Nhiệm vụ mỗi ngày",
    "30/60 giây",
    "Nhận 100 xu",
    "Đã nhận",
    "/explore",
    "width:50%",
    'aria-valuenow="30"',
  ])
    assert.ok(h.includes(s), s);
  assert.ok(!h.includes("3 tập"));
  assert.ok(!h.includes("Đang hoàn thiện"));
});
test("busy claims cannot be resubmitted and retain satin coin visual", () => {
  const h = renderToStaticMarkup(
    React.createElement(DailyMissions, { data, pending: "VIP_1_TASK_01", onClaim() {} }),
  );
  assert.match(h, /aria-busy="true" disabled=""/);
  assert.ok(h.includes("reward-coin-satin.webp"));
});
