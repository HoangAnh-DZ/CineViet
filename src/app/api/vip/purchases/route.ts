import { requireUser } from "@/server/auth";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
import { userVipPurchases, createVipPurchase, vipBankRequest } from "@/server/vip-purchases";
import { z } from "zod";
import { vipOrderState } from "@/server/vip-orders";
export async function GET(request: Request) {
  try {
    const u = await requireUser();
    const query = new URL(request.url).searchParams;
    if (query.get("view") === "state") {
      await throttleAuth("vip-history:" + u.id, 60);
      return json(await vipOrderState(u.id));
    }
    if (query.has("id") || query.has("plan_id"))
      return json({
        request: await vipBankRequest(
          u.id,
          query.has("id")
            ? { id: z.uuid().parse(query.get("id")) }
            : { planId: z.string().min(1).max(80).parse(query.get("plan_id")) },
        ),
      });
    return json(await userVipPurchases(u.id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("vip-purchase:" + u.id, 20);
    return json(await createVipPurchase(u.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
