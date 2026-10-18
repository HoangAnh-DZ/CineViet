import { protectPage } from "@/server/auth";
import { PayosStatusScreen } from "@/features/wallet/payos-status-screen";
export const metadata={title:"Thanh toán payOS"};
export default async function Page({params}:{params:Promise<{id:string}>}){await protectPage();return <PayosStatusScreen id={(await params).id}/>;}
