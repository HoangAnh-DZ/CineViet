import { requireAdmin } from "@/server/admin";
import { checkOrigin, readBody, json, failure, ApiError } from "@/server/http";
import {
  confirmWebhook,
  payosConfigured,
  getPaymentInfo,
  PayosApiError,
} from "@/server/payos-client";
import { payoutAccess, autoPayoutEnabled } from "@/server/payos-payout";
import { reconcilePendingPayments } from "@/server/payos-payments";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET() {
  try {
    await requireAdmin();
    let collection_access = "UNVERIFIED";
    if (payosConfigured()) {
      // Read-only lookup of a reserved, nonexistent code: validates credentials and signing without an order.
      try {
        await getPaymentInfo(9007199254740990);
        collection_access = "AVAILABLE";
      } catch (e) {
        if (e instanceof PayosApiError && e.paymentNotFound) collection_access = "AVAILABLE";
      }
    } else collection_access = "UNAVAILABLE";
    return json({
      configured: payosConfigured(),
      collection_access,
      payout_access: await payoutAccess(),
      auto_payout_enabled: autoPayoutEnabled(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireAdmin();
    const d = (await readBody(request)) as { action?: string };
    if (d.action === "REGISTER_WEBHOOK") return json(await confirmWebhook());
    if (d.action === "RECONCILE") return json(await reconcilePendingPayments());
    throw new ApiError(400, "Thao tác không hợp lệ.");
  } catch (e) {
    return failure(e);
  }
}
