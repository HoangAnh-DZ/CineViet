import { protectPage } from "@/server/auth";
import { PaymentScreen } from "@/features/wallet/payment-screen";
import { moneyConfig } from "@/server/money-config";
import { balances } from "@/server/account";
import { userMoneyRequests } from "@/server/manual-money";
export const metadata = { title: "Nạp tiền" };
export default async function Page() {
  const user = await protectPage();
  const [balance, requests] = await Promise.all([
    balances(user.id),
    userMoneyRequests(user.id, "VND"),
  ]);
  return (
    <PaymentScreen
      config={await moneyConfig()}
      available={balance.available}
      initialRequests={requests}
    />
  );
}
