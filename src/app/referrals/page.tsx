import { protectPage } from "@/server/auth";
import { referralDashboard } from "@/server/referrals";
import { headers } from "next/headers";
import { requestOrigin } from "@/server/http";
import { ReferralScreen } from "@/features/profile/referral-screen";
export const metadata = { title: "Giới thiệu bạn bè" };
export default async function Page() {
  const user = await protectPage();
  return (
    <ReferralScreen
      initial={await referralDashboard(user.id)}
      origin={requestOrigin({ headers: await headers() })}
    />
  );
}
