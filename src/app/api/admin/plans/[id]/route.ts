import { requireAdmin } from "@/server/admin";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { updateVipPlan } from "@/server/admin-plans";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const { id } = await params;
    return json(await updateVipPlan((await requireAdmin()).id, id, await readBody(request)));
  } catch (error) { return failure(error); }
}
