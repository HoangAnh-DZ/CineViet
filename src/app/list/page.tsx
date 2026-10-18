import { currentUser } from "@/server/auth";
import { librarySnapshot } from "@/server/library";
import { ListScreen } from "@/features/library/list-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "Danh sách" };
export default async function Page() {
  const u = await currentUser();
  return (
    <ListScreen
      signedIn={!!u}
      initial={u ? await librarySnapshot(u.id) : { recent: [], movies: [], shorts: [] }}
    />
  );
}
