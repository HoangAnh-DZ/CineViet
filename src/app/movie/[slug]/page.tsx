import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { findMovie, movieEpisodes, relatedMovies } from "@/server/catalog";
import { MovieDetail } from "@/features/catalog/movie-detail";
import { siteOrigin } from "@/lib/site";
export const dynamic = "force-dynamic";
const getMovie = cache(findMovie);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const movie = await getMovie((await params).slug);
  if (!movie) return { title: "Không tìm thấy phim", robots: { index: false } };
  const url = `${siteOrigin}/movie/${encodeURIComponent(movie.slug)}`;
  const description = movie.description.slice(0, 180);
  return {
    title: movie.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: movie.title,
      description,
      url,
      type: "video.movie",
      images: [new URL(movie.backdrop, siteOrigin).href],
    },
  };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const movie = await getMovie(slug);
  if (!movie) notFound();
  const [episodes, related] = await Promise.all([movieEpisodes(movie.id), relatedMovies(movie.id)]);
  return <MovieDetail movie={movie} episodes={episodes} related={related} />;
}
