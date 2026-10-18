import { protectPage } from "@/server/auth";
import { redemptionSnapshot, redemptionHistory } from "@/server/redemption";
import { RedemptionScreen } from "@/features/rewards/redemption-screen";
import { savedBankAccounts } from "@/server/bank-accounts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Đổi thưởng" };
export default async function Page() {
  const u = await protectPage();
  const [snapshot, requests, accounts] = await Promise.all([
    redemptionSnapshot(u.id),
    redemptionHistory(u.id),
    savedBankAccounts(u.id),
  ]);
  return (
    <RedemptionScreen snapshot={snapshot} initialRequests={requests} initialAccounts={accounts} />
  );
}
