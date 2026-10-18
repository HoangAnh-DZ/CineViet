import { requireUser } from "@/server/auth";
import { librarySnapshot } from "@/server/library";
import { json, failure } from "@/server/http";
export async function GET() {
  try {
    const u = await requireUser();
    return json(await librarySnapshot(u.id));
  } catch (e) {
    return failure(e);
  }
}
