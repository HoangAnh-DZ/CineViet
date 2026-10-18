import { z } from "zod";
import { requireUser } from "@/server/auth";
import { throttleAuth } from "@/server/auth-core";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import { cancelVipOrder } from "@/server/vip-orders";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("vip-cancel:" + u.id, 15);
    const id = z.uuid().parse((await params).id);
    z.object({ action: z.literal("cancel"), confirmed: z.literal(true) })
      .strict()
      .parse(await readBody(request));
    return json(await cancelVipOrder(u.id, id));
  } catch (e) {
    return failure(e);
  }
}
