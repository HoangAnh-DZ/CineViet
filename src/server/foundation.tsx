import { protectPage } from "./auth";
import { balances, coinLedger, walletLedger } from "./account";
import { calendarDay } from "@/domain/rules";
import { RewardsScreen } from "@/features/rewards/rewards-screen";
import { WalletScreen } from "@/features/wallet/wallet-screen";
import type { CoinLedgerEntry, WalletLedgerEntry } from "@/domain/models";
export async function rewardsPage() {
  const user = await protectPage();
  const [balance, ledger] = await Promise.all([balances(user.id), coinLedger(user.id)]);
  return (
    <RewardsScreen
      data={{
        wallet: { id: user.id, user_id: user.id, asset: "COIN", balance: balance.coins },
        days: [10, 15, 20, 25, 30, 40, 60].map((reward, i) => ({
          day: i + 1,
          reward,
          status: "LOCKED",
        })),
        ledger: ledger as CoinLedgerEntry[],
        calendar_date: calendarDay(new Date()),
        timezone: "Asia/Ho_Chi_Minh",
      }}
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
