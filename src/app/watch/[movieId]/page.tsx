import { renderWatch } from "@/server/watch";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ movieId: string }> }) {
  return renderWatch((await params).movieId);
}
