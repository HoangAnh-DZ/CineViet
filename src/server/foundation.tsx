import { protectPage } from "./auth";
import { balances, walletLedger } from "./account";
import { rewardsSnapshot } from "./rewards";
import { missionsSnapshot } from "./missions";
import { RewardsScreen } from "@/features/rewards/rewards-screen";
import { WalletScreen } from "@/features/wallet/wallet-screen";
import type { WalletLedgerEntry } from "@/domain/models";
export async function rewardsPage() {
  const user = await protectPage();
  const [data, missions] = await Promise.allSettled([
    rewardsSnapshot(user.id),
    missionsSnapshot(user.id),
  ]);
  return (
    <RewardsScreen
      data={data.status === "fulfilled" ? data.value : null}
      missions={missions.status === "fulfilled" ? missions.value : null}
    />
  );
}
export async function walletPage(history = false) {
  const user = await protectPage();
  const [balance, ledger] = await Promise.all([balances(user.id), walletLedger(user.id)]);
  return (
    <WalletScreen
      history={history}
      balance={balance.cash}
      available={balance.available}
      coins={balance.coins}
      transactions={ledger as WalletLedgerEntry[]}
    />
  );
}
