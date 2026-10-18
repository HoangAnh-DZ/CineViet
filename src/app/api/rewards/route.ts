import { requireUser } from "@/server/auth";
import { claimDailyCheckIn, rewardsSnapshot } from "@/server/rewards";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { z } from "zod";
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
    // Existing clients send no body; explicit JSON must be an empty object.
    if (request.body)
      z.object({})
        .strict()
        .parse(await readBody(request, 8192, true));
    return json(await claimDailyCheckIn(user.id));
  } catch (error) {
    return failure(error);
  }
}
