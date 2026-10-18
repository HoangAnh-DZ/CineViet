import { requireUser } from "@/server/auth";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { redeemRewardCode } from "@/server/reward-codes";
import { throttleAuth } from "@/server/auth-core";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth(`reward-code:${user.id}`, 20);
    return json(await redeemRewardCode(user.id, await readBody(request)));
  } catch (error) {
    return failure(error);
  }
}
