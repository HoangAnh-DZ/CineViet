import { notFound } from "next/navigation";
import { findMovie, movieEpisodes, relatedMovies, playback } from "@/server/catalog";
import { MovieDetail } from "@/features/catalog/movie-detail";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const movie = await findMovie(slug);
  if (!movie) notFound();
  const [episodes, related, media] = await Promise.all([
    movieEpisodes(movie.id),
    relatedMovies(movie.id),
    playback(movie.id),
  ]);
  return (
    <MovieDetail
      movie={movie}
      episodes={episodes}
      related={related}
      previewUrl={!movie.vip_required ? media.sources[0]?.url : undefined}
    />
  );
}
