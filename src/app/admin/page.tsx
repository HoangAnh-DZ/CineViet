import { protectAdminPage } from "@/server/admin";
import { dashboardOverview } from "@/server/dashboard";
import { OverviewScreen } from "@/features/admin/dashboard-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Tổng quan" };
export default async function Page({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const u = await protectAdminPage();
  return (
    <OverviewScreen
      data={await dashboardOverview(u.id, (await searchParams).mode === "ALL" ? "ALL" : "BUSINESS")}
    />
  );
}
