import { requireAdmin } from "@/server/admin";
import { throttleAuth } from "@/server/auth-core";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { adminReferralReport } from "@/server/referral-reporting";
import { updateReferralPolicy } from "@/server/referral-policy";
export async function GET(request: Request) {
  try {
    const u = await requireAdmin();
    await throttleAuth(`admin-referrals-read:${u.id}`, 60);
    return json(
      await adminReferralReport(u.id, Object.fromEntries(new URL(request.url).searchParams)),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireAdmin();
    await throttleAuth(`admin-referrals-write:${u.id}`, 10);
    return json(await updateReferralPolicy(u.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
