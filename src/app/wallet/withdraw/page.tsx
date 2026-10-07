import { protectPage } from "@/server/auth";
import { PaymentScreen } from "@/features/wallet/payment-screen";
export const metadata = { title: "Rút tiền" };
export default async function Page() {
  await protectPage();
  return <PaymentScreen withdraw />;
}
