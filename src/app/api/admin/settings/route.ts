import { requireAdmin } from "@/server/admin";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { adminSystemSettings, updateSystemSettings } from "@/server/system-settings";

export async function GET() {
  try { return json(await adminSystemSettings((await requireAdmin()).id)); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    return json(await updateSystemSettings((await requireAdmin()).id, await readBody(request)));
  } catch (error) { return failure(error); }
}
