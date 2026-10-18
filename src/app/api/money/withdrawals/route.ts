import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { createWithdrawalRequest } from "@/server/manual-money";
import { throttleAuth } from "@/server/auth-core";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth("withdrawal-submit:" + user.id, 20);
    return json(await createWithdrawalRequest(user.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
