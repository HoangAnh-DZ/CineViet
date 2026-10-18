import { authorizedCron } from "@/server/cron-auth";
import { runSocialSync } from "@/server/social-shorts";
import { json, failure } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!authorizedCron(request)) return json({ error: "Không có quyền đồng bộ." }, 401);
  try {
    return json(await runSocialSync("CRON"));
  } catch (e) {
    return failure(e);
  }
}
