import { protectPage } from "@/server/auth";
import { Suspense } from "react";
import { ProfileScreen } from "@/features/profile/profile-screen";
import { LoadingScreen } from "@/components/ui";
import { referralSummary } from "@/server/account";
import { rewardsSnapshot } from "@/server/rewards";
export const metadata = { title: "Của tôi" };
export default async function Page() {
  const user = await protectPage();
  const [rewards, referral] = await Promise.all([
    rewardsSnapshot(user.id),
    referralSummary(user.id),
  ]);
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ProfileScreen
        initialUser={user}
        membership={rewards.membership}
        referral={referral}
      />
    </Suspense>
  );
}
