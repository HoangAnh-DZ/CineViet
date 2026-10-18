import { protectAdminPage } from "@/server/admin";
import { AdminShell } from "@/features/admin/admin-shell";
import "@/features/admin/dashboard.css";
export default async function Layout({ children }: { children: React.ReactNode }) {
  const u = await protectAdminPage();
  return <AdminShell name={u.username}>{children}</AdminShell>;
}
