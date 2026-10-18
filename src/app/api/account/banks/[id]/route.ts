import { z } from "zod";
import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure, ApiError } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
import { saveBankAccount, defaultBankAccount, deleteBankAccount } from "@/server/bank-accounts";
import { bankAccountInput } from "@/domain/bank-accounts";
type Context = { params: Promise<{ id: string }> };
const updateInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("default") }).strict(),
  z.object({ action: z.literal("update"), account: bankAccountInput }).strict(),
]);
async function actor(request: Request, context: Context) {
  checkOrigin(request);
  const u = await requireUser();
  await throttleAuth("bank-write:" + u.id, 30);
  const id = (await context.params).id;
  if (!z.string().uuid().safeParse(id).success)
    throw new ApiError(404, "Tài khoản ngân hàng không còn khả dụng.");
  return { u, id };
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { u, id } = await actor(request, context);
    const d = updateInput.parse(await readBody(request));
    return json(
      d.action === "default"
        ? await defaultBankAccount(u.id, id)
        : await saveBankAccount(u.id, d.account, id),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { u, id } = await actor(request, context);
    return json(await deleteBankAccount(u.id, id));
  } catch (e) {
    return failure(e);
  }
}
