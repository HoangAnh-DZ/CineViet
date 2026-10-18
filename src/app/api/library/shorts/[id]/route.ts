import { z } from "zod";
import { requireUser } from "@/server/auth";
import { bookmarkShort } from "@/server/library";
import { json, failure, checkOrigin, readBody } from "@/server/http";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await requireUser();
    checkOrigin(request);
    const b = z
      .object({ saved: z.boolean() })
      .strict()
      .parse(await readBody(request));
    return json(await bookmarkShort(u.id, (await params).id, b.saved));
  } catch (e) {
    return failure(e);
  }
}
