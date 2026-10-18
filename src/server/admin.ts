import "server-only";
import { redirect } from "next/navigation";
import { protectPage, requireUser } from "./auth";
import { assertAdmin, hasAdminAccess } from "./admin-core";
export async function requireAdmin() {
  const user = await requireUser();
  await assertAdmin(user.id);
  return user;
}

export async function protectAdminPage() {
  const user = await protectPage();
  if (!(await hasAdminAccess(user.id))) redirect("/profile");
  return user;
}
