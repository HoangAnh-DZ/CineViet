import { requireAdmin } from "@/server/admin";
import { adminShortsList } from "@/server/shorts";
import { saveShort } from "@/server/admin-shorts";
import { checkOrigin, readBody, json, failure } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdmin();
    return json(
      await adminShortsList(Number(new URL(request.url).searchParams.get("cursor") || 0)),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    checkOrigin(request);
    return json(await saveShort(user.id, await readBody(request)), 201);
  } catch (e) {
    return failure(e);
  }
}
