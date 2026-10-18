import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
export async function hasAdminAccess(userId: string) {
  const result = await database().execute(
    sql`SELECT 1 FROM cinevjet.admin_users a JOIN cinevjet.users u ON u.id=a.user_id WHERE a.user_id=${userId} AND u.status='ACTIVE' LIMIT 1`,
  );
  return result.rows.length > 0;
}
export async function assertAdmin(userId: string) {
  if (!(await hasAdminAccess(userId))) throw new ApiError(403, "Bạn không có quyền quản trị.");
}
