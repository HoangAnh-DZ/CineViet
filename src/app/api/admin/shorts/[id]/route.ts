import { z } from "zod";
import { requireAdmin } from "@/server/admin";
import { saveShort, setShortActive, deleteShort } from "@/server/admin-shorts";
import { checkOrigin, readBody, json, failure } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, ctx: Context) {
  try {
    const u = await requireAdmin();
    checkOrigin(request);
    return json(await saveShort(u.id, await readBody(request), (await ctx.params).id));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request, ctx: Context) {
  try {
    const u = await requireAdmin();
    checkOrigin(request);
    const b = z
      .object({ is_active: z.boolean() })
      .strict()
      .parse(await readBody(request));
    return json(await setShortActive(u.id, (await ctx.params).id, b.is_active));
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, ctx: Context) {
  try {
    const u = await requireAdmin();
    checkOrigin(request);
    return json(await deleteShort(u.id, (await ctx.params).id));
  } catch (e) {
    return failure(e);
  }
}
