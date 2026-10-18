import { moviePresentation } from "@/features/admin/presentation-data";
import { requireAdmin } from "@/server/admin";
import { saveMovie } from "@/server/dashboard";
import { json, failure, readBody, checkOrigin } from "@/server/http";
export async function GET(r: Request) {
  try {
    const u = await requireAdmin(),
      q = new URL(r.url).searchParams;
    return json(
      await moviePresentation(
        u.id,
        q.get("q") || "",
        q.get("type") || "",
        q.get("status") || "",
        Number(q.get("page") || 1),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    const u = await requireAdmin();
    checkOrigin(r);
    return json(await saveMovie(u.id, await readBody(r, 512 * 1024)), 201);
  } catch (e) {
    return failure(e);
  }
}
