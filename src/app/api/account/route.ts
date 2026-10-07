import { currentUser, requireUser } from "@/server/auth";
import { balances, entitlements, favoriteMovies, history } from "@/server/account";
import { database } from "@/server/db";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { z } from "zod";
import { sql } from "drizzle-orm";
export async function GET() {
  try {
    const user = await currentUser();
    if (!user)
      return json({
        user: null,
        favoriteMovies: [],
        progress: [],
        balance: { cash: 0, available: 0, coins: 0 },
        entitlements: [],
      });
    const [favorites, progress, balance, rights] = await Promise.all([
      favoriteMovies(user.id),
      history(user.id),
      balances(user.id),
      entitlements(user.id),
    ]);
    return json({ user, favoriteMovies: favorites, progress, balance, entitlements: rights });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const data = z
      .object({ display_name: z.string().trim().min(2).max(80) })
      .parse(await readBody(request));
    await database().execute(
      sql`UPDATE cinevjet.users SET display_name=${data.display_name},updated_at=now() WHERE id=${user.id}`,
    );
    return json({ user: { ...user, username: data.display_name } });
  } catch (e) {
    return failure(e);
  }
}
