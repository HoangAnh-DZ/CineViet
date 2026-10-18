import "@/features/rewards/rewards-vip.css";
import { VipScreen } from "@/features/vip/vip-screen";
import { vipPlans } from "@/server/account";
import { currentUser } from "@/server/auth";
import { vipMembershipName } from "@/server/rewards";
import { vipOrderState } from "@/server/vip-orders";
import { moneyConfig } from "@/server/money-config";
export const dynamic = "force-dynamic";
export default async function Page() {
  const [plans, user, config] = await Promise.all([vipPlans(), currentUser(), moneyConfig()]);
  const [membership, state] = await Promise.all([
    vipMembershipName(user?.id),
    user ? vipOrderState(user.id) : Promise.resolve({ requests: [], purchased: [] }),
  ]);
  return (
    <VipScreen
      plans={plans}
      membershipName={membership}
      signedIn={!!user}
      config={config}
      initialRequests={state.requests}
      initialPurchased={state.purchased}
    />
  );
}
