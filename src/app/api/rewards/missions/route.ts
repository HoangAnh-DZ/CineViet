import { requireUser } from "@/server/auth";
import { missionsSnapshot, claimMission } from "@/server/missions";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
export async function GET() {
  try {
    return json(await missionsSnapshot((await requireUser()).id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth(`mission-claim:${user.id}`, 120);
    return json(await claimMission(user.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
