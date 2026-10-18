import { sql } from "drizzle-orm";
import { protectAdminPage } from "@/server/admin";
import { database } from "@/server/db";
import { ReferralsScreen, type ReferralAdminData } from "@/features/admin/referrals-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Giới thiệu / hoa hồng" };
export default async function Page() {
  await protectAdminPage();
  const [summary, rows] = await Promise.all([
    database().execute(
      sql`SELECT count(*)::int AS total,COALESCE(sum(amount),0)::bigint AS earned FROM cinevjet.referral_commissions`,
    ),
    database()
      .execute(sql`SELECT u.email,u.display_name,count(c.id)::int AS referred,COALESCE(sum(c.amount),0)::bigint AS earned
      FROM cinevjet.referral_commissions c JOIN cinevjet.users u ON u.id=c.referrer_id
      GROUP BY u.id,u.email,u.display_name ORDER BY earned DESC, referred DESC LIMIT 100`),
  ]);
  const data: ReferralAdminData = {
    total: Number(summary.rows[0]?.total || 0),
    earned: Number(summary.rows[0]?.earned || 0),
    referrers: rows.rows.map((row) => ({
      email: String(row.email),
      display_name: String(row.display_name),
      referred: Number(row.referred),
      earned: Number(row.earned),
    })),
  };
  return <ReferralsScreen data={data} />;
}
