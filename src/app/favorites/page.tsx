import { protectPage } from "@/server/auth";
import { LibraryScreen } from "@/features/catalog/library-screen";
export const metadata = { title: "Phim yêu thích" };
export default async function Page() {
  await protectPage();
  return <LibraryScreen />;
}
