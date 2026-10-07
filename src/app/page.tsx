import { HomeScreen } from "@/features/home/home-screen";
import { homeCatalog } from "@/server/catalog";
export const dynamic = "force-dynamic";
export default async function Page() {
  return <HomeScreen data={await homeCatalog()} />;
}
