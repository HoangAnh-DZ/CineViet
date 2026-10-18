import { z } from "zod";
import { requireAdmin } from "@/server/admin";
import { throttleAuth } from "@/server/auth-core";
import { failure, json } from "@/server/http";
import { financialReportRevision } from "@/server/financial-reporting";
export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    z.object({})
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    await throttleAuth(`admin-reporting-revision:${actor.id}`, 120);
    const revision = await financialReportRevision(actor.id),
      etag = '"' + revision + '"';
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-store" },
      });
    return json({ revision }, 200, { ETag: etag });
  } catch (e) {
    return failure(e);
  }
}
