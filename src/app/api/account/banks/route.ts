import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
import { savedBankAccounts, saveBankAccount } from "@/server/bank-accounts";
export async function GET() {
  try {
    const u = await requireUser();
    return json(await savedBankAccounts(u.id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("bank-write:" + u.id, 30);
    return json(await saveBankAccount(u.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
