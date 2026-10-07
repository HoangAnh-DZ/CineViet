import { requireUser } from "@/server/auth";
import { setFavorite } from "@/server/account";
import { checkOrigin, failure, json, readBody } from "@/server/http";
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    return json(await setFavorite(user.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
