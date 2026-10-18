import { requireUser } from "@/server/auth";
import { throttleAuth } from "@/server/auth-core";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { createPayosOrder, pendingVipPayment, paymentPresentation } from "@/server/payos-payments";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const u = await requireUser();
    const planId = z
      .string()
      .min(1)
      .max(80)
      .parse(new URL(request.url).searchParams.get("plan_id"));
    const order = await pendingVipPayment(u.id, planId);
    return json({ order: order ? await paymentPresentation(order, u.id) : null });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const origin = checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("payos-create:" + u.id, 20);
    return json(
      await paymentPresentation(
        await createPayosOrder(u.id, await readBody(request), origin),
        u.id,
      ),
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
