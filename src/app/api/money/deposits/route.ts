import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { createDepositRequest } from "@/server/manual-money";
import { throttleAuth } from "@/server/auth-core";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth("deposit-submit:" + user.id, 20);
    return json(await createDepositRequest(user.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
