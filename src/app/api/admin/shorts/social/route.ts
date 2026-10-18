import { requireAdmin } from "@/server/admin";
import { throttleAuth } from "@/server/auth-core";
import { json, failure, readBody, checkOrigin, ApiError } from "@/server/http";
import {
  socialShortsAdmin,
  saveSocialSource,
  importSocialUrls,
  reviewSocialShort,
  checkSocialShort,
  configureSocialSync,
  runSocialSync,
} from "@/server/social-shorts";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const u = await requireAdmin();
    return json(
      await socialShortsAdmin(u.id, Number(new URL(request.url).searchParams.get("page")) || 1),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const u = await requireAdmin();
    const body = (await readBody(request)) as { action?: string; input?: unknown };
    await throttleAuth(`social-shorts:${u.id}`, 40);
    switch (body.action) {
      case "SOURCE":
        return json(await saveSocialSource(u.id, body.input));
      case "IMPORT":
        return json(await importSocialUrls(u.id, body.input));
      case "CHECK":
        return json(
          await checkSocialShort(u.id, String((body.input as { id?: string })?.id || "")),
        );
      case "REVIEW":
        return json(await reviewSocialShort(u.id, body.input));
      case "SETTINGS":
        return json(await configureSocialSync(u.id, body.input));
      case "SYNC":
        await throttleAuth(`social-sync:${u.id}`, 6);
        return json(await runSocialSync("ADMIN", u.id));
      default:
        throw new ApiError(400, "Thao tác không hợp lệ.");
    }
  } catch (e) {
    return failure(e);
  }
}
