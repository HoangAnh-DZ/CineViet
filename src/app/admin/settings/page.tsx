import { protectAdminPage } from "@/server/admin";
import { adminSystemSettings } from "@/server/system-settings";
import { SettingsScreen } from "@/features/admin/settings-screen";
export const metadata = { title: "Admin · Cài đặt" };
export default async function Page() {
  const u = await protectAdminPage();
  return <SettingsScreen initial={await adminSystemSettings(u.id)} />;
}
