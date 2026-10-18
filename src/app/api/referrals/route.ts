import { requireUser } from "@/server/auth";
import { json, failure } from "@/server/http";
import { referralDashboard } from "@/server/referrals";
import { throttleAuth } from "@/server/auth-core";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await throttleAuth("referrals:"+user.id,60);
    return json(
      await referralDashboard(user.id, Object.fromEntries(new URL(request.url).searchParams)),
    );
  } catch (error) {
    return failure(error);
  }
}
