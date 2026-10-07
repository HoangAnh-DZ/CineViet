import { ExploreScreen } from "@/features/catalog/explore-screen";
import { catalogOptions, searchCatalog } from "@/server/catalog";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = await searchParams;
  const [initial, options] = await Promise.all([searchCatalog(filters), catalogOptions()]);
  return <ExploreScreen search initial={initial} options={options} filters={filters} />;
}
