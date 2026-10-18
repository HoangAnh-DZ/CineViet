import { protectAdminPage } from "@/server/admin";
import { moviePresentation } from "@/features/admin/presentation-data";
import { VideosScreen } from "@/features/admin/management-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Quản lý video" };
export default async function Page() {
  const u = await protectAdminPage();
  return <VideosScreen initial={await moviePresentation(u.id)} />;
}
