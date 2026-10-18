import { ShortsScreen } from "@/features/shorts/shorts-screen";
import { shortsFeed } from "@/server/shorts";
export const dynamic = "force-dynamic";
export const metadata = { title: "Phim ngắn" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const selectedId = typeof id === "string" ? id : undefined;
  const batch = await shortsFeed(undefined, selectedId);
  return (
    <ShortsScreen
      key={`${selectedId || "latest"}:${batch.items.map((item) => item.id).join(",")}`}
      initialBatch={batch}
      selectedId={selectedId}
    />
  );
}
