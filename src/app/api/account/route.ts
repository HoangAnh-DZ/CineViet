import { currentUser, requireUser } from "@/server/auth";
import { balances, entitlements, favoriteMovies, history } from "@/server/account";
import { database } from "@/server/db";
import { checkOrigin, failure, json, readBody } from "@/server/http";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { savedShortIds } from "@/server/library";
import { throttleAuth } from "@/server/auth-core";
import { updateDisplayName } from "@/server/account-security";
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
        savedShortIds: [],
      });
    await throttleAuth(`api:${user.id}`, 360, 1);
    const [favorites, progress, balance, rights, bookmarks] = await Promise.all([
      favoriteMovies(user.id),
      history(user.id),
      balances(user.id),
      entitlements(user.id),
      savedShortIds(user.id),
    ]);
    return json({
      user,
      favoriteMovies: favorites,
      progress,
      balance,
      entitlements: rights,
      savedShortIds: bookmarks,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    return json(await updateDisplayName(user.id, await readBody(request)));
  } catch (e) {
    return failure(e);
  }
}
