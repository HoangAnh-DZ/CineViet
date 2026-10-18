import { requireUser } from "@/server/auth";
import { startRewardWatch, heartbeatRewardWatch } from "@/server/missions";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth(`watch-start:${user.id}`, 60);
    return json(await startRewardWatch(user.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth(`watch-heartbeat:${user.id}`, 600);
    return json(await heartbeatRewardWatch(user.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
