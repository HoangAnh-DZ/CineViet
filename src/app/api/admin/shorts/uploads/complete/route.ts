import { z } from "zod";
import { requireAdmin } from "@/server/admin";
import { verifyShortUpload } from "@/server/short-uploads";
import { checkOrigin, readBody, json, failure } from "@/server/http";
export async function POST(request: Request) {
  try {
    const u = await requireAdmin();
    checkOrigin(request);
    const b = z
      .object({ url: z.string().max(2048), kind: z.enum(["video", "thumbnail"]) })
      .strict()
      .parse(await readBody(request));
    return json(await verifyShortUpload(u.id, b.url, b.kind));
  } catch (e) {
    return failure(e);
  }
}
