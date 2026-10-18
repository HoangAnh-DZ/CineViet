import { requireAdmin } from "@/server/admin";
import { saveMovie, hideMovie, movieEditorData } from "@/server/dashboard";
import { json, failure, readBody, checkOrigin } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_r: Request, c: Context) {
  try {
    const u = await requireAdmin();
    return json(await movieEditorData(u.id, (await c.params).id));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(r: Request, c: Context) {
  try {
    const u = await requireAdmin();
    checkOrigin(r);
    return json(await saveMovie(u.id, await readBody(r, 512 * 1024), (await c.params).id));
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(r: Request, c: Context) {
  try {
    const u = await requireAdmin();
    checkOrigin(r);
    return json(await hideMovie(u.id, (await c.params).id));
  } catch (e) {
    return failure(e);
  }
}
