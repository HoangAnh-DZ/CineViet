import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
export async function hasAdminAccess(
  userId: string,
  executor: Pick<ReturnType<typeof database>, "execute"> = database(),
) {
  const result = await executor.execute(
    sql`SELECT 1 FROM cinevjet.admin_users a JOIN cinevjet.users u ON u.id=a.user_id WHERE a.user_id=${userId} AND u.status='ACTIVE' LIMIT 1`,
  );
  return result.rows.length > 0;
}
export async function assertAdmin(
  userId: string,
  executor: Pick<ReturnType<typeof database>, "execute"> = database(),
) {
  if (!(await hasAdminAccess(userId, executor)))
    throw new ApiError(403, "Bạn không có quyền quản trị.");
}
