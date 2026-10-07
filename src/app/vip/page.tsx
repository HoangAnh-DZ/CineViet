import { VipScreen } from "@/features/vip/vip-screen";
import { vipPlans } from "@/server/account";
export const dynamic = "force-dynamic";
export default async function Page() {
  return <VipScreen plans={await vipPlans()} />;
}
