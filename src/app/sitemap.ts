import type { MetadataRoute } from "next";
import { publicMoviePages } from "@/server/catalog";
import { siteOrigin } from "@/lib/site";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const movies = await publicMoviePages();
  return [
    { url: `${siteOrigin}/explore` },
    ...movies.map((movie) => ({
      url: `${siteOrigin}/movie/${encodeURIComponent(movie.slug)}`,
      lastModified: movie.updatedAt,
    })),
  ];
}
