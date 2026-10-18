import { requireAdmin } from "@/server/admin";
import { userPresentation } from "@/features/admin/presentation-data";
import { json, failure } from "@/server/http";
export async function GET(r: Request) {
  try {
    const u = await requireAdmin();
    return json({
      items: await userPresentation(u.id, new URL(r.url).searchParams.get("q") || ""),
    });
  } catch (e) {
    return failure(e);
  }
}
