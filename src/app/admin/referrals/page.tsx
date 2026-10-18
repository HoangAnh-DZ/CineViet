import { protectAdminPage } from "@/server/admin";
import { adminReferralReport } from "@/server/referral-reporting";
import { ReferralsScreen } from "@/features/admin/referrals-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Giới thiệu / hoa hồng" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; period?: string }>;
}) {
  const actor = await protectAdminPage();
  const q = await searchParams;
  return (
    <ReferralsScreen
      data={await adminReferralReport(actor.id, {
        mode: q.mode === "ALL" ? "ALL" : "BUSINESS",
        period: q.period,
      })}
    />
  );
}
