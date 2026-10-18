import { requireUser } from "@/server/auth";
import { throttleAuth } from "@/server/auth-core";
import { json, failure } from "@/server/http";
import { reconcilePayosOrder, paymentPresentation } from "@/server/payos-payments";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    await throttleAuth("payos-status:" + u.id, 120);
    return json(
      await paymentPresentation(await reconcilePayosOrder((await params).id, u.id), u.id),
    );
  } catch (e) {
    return failure(e);
  }
}
