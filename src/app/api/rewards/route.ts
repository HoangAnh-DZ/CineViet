import { requireUser } from "@/server/auth";
import { claimDailyCheckIn, rewardsSnapshot } from "@/server/rewards";
import { checkOrigin, failure, json } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
export async function GET() {
  try {
    return json(await rewardsSnapshot((await requireUser()).id));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth(`checkin:${user.id}`, 30);
    return json(await claimDailyCheckIn(user.id));
  } catch (error) {
    return failure(error);
  }
}
