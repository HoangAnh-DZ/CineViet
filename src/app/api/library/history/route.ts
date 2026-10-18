import { z } from "zod";
import { requireUser } from "@/server/auth";
import { removeHistory } from "@/server/library";
import { json, failure, checkOrigin, readBody } from "@/server/http";
export async function DELETE(request: Request) {
  try {
    const u = await requireUser();
    checkOrigin(request);
    const b = z
      .object({ movie_id: z.string().min(1).max(500), episode_id: z.string().max(500).nullable() })
      .strict()
      .parse(await readBody(request));
    return json(await removeHistory(u.id, b.movie_id, b.episode_id));
  } catch (e) {
    return failure(e);
  }
}
