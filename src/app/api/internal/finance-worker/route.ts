import { timingSafeEqual } from "node:crypto";
import { runPayoutWorker } from "@/server/withdrawal-queue";
import { reconcilePendingPayments } from "@/server/payos-payments";
import { json, failure, readBody, ApiError } from "@/server/http";
import { confirmWebhook } from "@/server/payos-client";
import { payoutAccess, autoPayoutEnabled } from "@/server/payos-payout";
import { scrubRewardRiskCounters } from "@/server/reward-risk";
export const runtime = "nodejs";
export const maxDuration = 60;
function authorized(request: Request) {
  const expected = process.env.CRON_SECRET,
    token = request.headers.get("authorization");
  return (
    !!expected &&
    !!token &&
    Buffer.byteLength(token) === Buffer.byteLength(`Bearer ${expected}`) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(`Bearer ${expected}`))
  );
}
export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Không có quyền chạy worker." }, 401);
  try {
    // Retention failures do not block payment reconciliation/dispatch.
    await scrubRewardRiskCounters().catch(() =>
      console.error("Reward risk retention unavailable."),
    );
    return json({ payout: await runPayoutWorker(), payments: await reconcilePendingPayments(2) });
  } catch (e) {
    return failure(e);
  }
}
// Server-to-server setup uses the same scheduler secret. No payment creation or balance mutation.
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "Không có quyền cấu hình worker." }, 401);
  try {
    const body = (await readBody(request)) as { action?: string };
    if (body.action !== "REGISTER_WEBHOOK") throw new ApiError(400, "Thao tác không hợp lệ.");
    return json({
      ...(await confirmWebhook()),
      payout_access: await payoutAccess(),
      auto_payout_enabled: autoPayoutEnabled(),
    });
  } catch (e) {
    return failure(e);
  }
}
