import { protectAdminPage } from "@/server/admin";
import { userPresentation } from "@/features/admin/presentation-data";
import { UsersScreen } from "@/features/admin/management-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Người dùng" };
export default async function Page() {
  const u = await protectAdminPage();
  return <UsersScreen initial={await userPresentation(u.id)} actor={u.id} />;
}
