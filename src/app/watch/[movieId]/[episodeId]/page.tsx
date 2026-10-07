import { renderWatch } from "@/server/watch";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ movieId: string; episodeId: string }>;
}) {
  const { movieId, episodeId } = await params;
  return renderWatch(movieId, episodeId);
}
