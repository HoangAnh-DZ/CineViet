import { ExploreScreen } from "@/features/catalog/explore-screen";
import { catalogOptions, searchCatalog, homeCatalog } from "@/server/catalog";
import { siteOrigin } from "@/lib/site";
export const metadata = {
  title: "Khám phá phim",
  alternates: { canonical: `${siteOrigin}/explore` },
  openGraph: { url: `${siteOrigin}/explore`, siteName: "CineVjet", type: "website" },
};
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = await searchParams;
  const [initial, options, discovery] = await Promise.all([
    searchCatalog(filters),
    catalogOptions(),
    Object.keys(filters).length ? Promise.resolve(undefined) : homeCatalog(),
  ]);
  return (
    <ExploreScreen initial={initial} options={options} filters={filters} discovery={discovery} />
  );
}
