import { memberActivity } from "@/features/admin/presentation-data";
import { z } from "zod";
import { requireAdmin } from "@/server/admin";
import { setUserStatus } from "@/server/dashboard";
import { json, failure, checkOrigin, readBody } from "@/server/http";
export async function PATCH(r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireAdmin();
    checkOrigin(r);
    const d = z
      .object({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
      .strict()
      .parse(await readBody(r));
    return json(await setUserStatus(u.id, (await params).id, d.status));
  } catch (e) {
    return failure(e);
  }
}

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireAdmin();
    return json(await memberActivity(u.id, (await params).id));
  } catch (e) {
    return failure(e);
  }
}
