import { protectAdminPage } from "@/server/admin";
import { adminRewards } from "@/server/dashboard";
import { AdminRewardsScreen } from "@/features/admin/management-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Mã đổi thưởng" };
export default async function Page() {
  const u = await protectAdminPage();
  return <AdminRewardsScreen data={await adminRewards(u.id)} mode="codes" />;
}
