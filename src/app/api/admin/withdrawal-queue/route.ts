import { requireAdmin } from "@/server/admin";
import { checkOrigin, readBody, json, failure } from "@/server/http";
import {
  queueSnapshot,
  setQueueControl,
  queueAction,
  runPayoutWorker,
} from "@/server/withdrawal-queue";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  try {
    return json(await queueSnapshot((await requireAdmin()).id));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireAdmin();
    const input = await readBody(request);
    const d = z
      .object({
        action: z.enum(["CONTROL", "RETRY", "MANUAL_REVIEW", "RECONCILE"]),
        id: z.string().optional(),
        control: z.unknown().optional(),
      })
      .strict()
      .parse(input);
    if (d.action === "CONTROL") return json(await setQueueControl(u.id, d.control));
    if (d.action === "RECONCILE") return json(await runPayoutWorker(undefined, true));
    await queueAction(u.id, z.string().min(1).parse(d.id), d.action);
    return json(await queueSnapshot(u.id));
  } catch (e) {
    return failure(e);
  }
}
