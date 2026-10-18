import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
import { redemptionSnapshot, redemptionHistory, createRedemption } from "@/server/redemption";
import { savedBankAccounts } from "@/server/bank-accounts";
export async function GET() {
  try {
    const u = await requireUser();
    const [snapshot, requests, accounts] = await Promise.all([
      redemptionSnapshot(u.id),
      redemptionHistory(u.id),
      savedBankAccounts(u.id),
    ]);
    return json({ snapshot, requests, accounts });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("redemption-submit:" + u.id, 20);
    return json(await createRedemption(u.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
