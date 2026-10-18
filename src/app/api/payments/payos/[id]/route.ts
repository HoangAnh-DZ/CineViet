import { requireUser } from "@/server/auth";
import { throttleAuth } from "@/server/auth-core";
import { json, failure, checkOrigin, readBody } from "@/server/http";
import { z } from "zod";
import {
  reconcilePayosOrder,
  paymentPresentation,
  storedPayosOrder,
} from "@/server/payos-payments";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    await throttleAuth("payos-status:" + u.id, 120);
    return json(
      await paymentPresentation(
        await storedPayosOrder(z.uuid().parse((await params).id), u.id),
        u.id,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    await throttleAuth("payos-status:" + u.id, 120);
    const id = z.uuid().parse((await params).id);
    z.object({ action: z.literal("reconcile") })
      .strict()
      .parse(await readBody(request));
    return json(await paymentPresentation(await reconcilePayosOrder(id, u.id), u.id));
  } catch (e) {
    return failure(e);
  }
}
