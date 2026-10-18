import { protectPage } from "@/server/auth";
import { redirect } from "next/navigation";
export const metadata = { title: "Rút tiền" };
export default async function Page() {
  await protectPage();
  redirect("/rewards/redeem");
}
