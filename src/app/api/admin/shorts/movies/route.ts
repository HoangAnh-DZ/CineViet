import { requireAdmin } from "@/server/admin";
import { shortMovieOptions } from "@/server/admin-shorts";
import { json, failure } from "@/server/http";
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams;
    return json(await shortMovieOptions(q.get("q") || "", q.get("movie") || undefined));
  } catch (e) {
    return failure(e);
  }
}
