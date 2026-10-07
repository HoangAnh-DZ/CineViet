import { notFound, redirect } from "next/navigation";
import { findMovie, movieEpisodes, playback } from "./catalog";
import { currentUser } from "./auth";
import { entitlements } from "./account";
import { WatchScreen } from "@/features/player/watch-screen";
export async function renderWatch(movieId: string, episodeId?: string) {
  const [movie, episodes, user] = await Promise.all([
    findMovie(movieId),
    movieEpisodes(movieId),
    currentUser(),
  ]);
  if (!movie) notFound();
  if (movie.type === "SERIES" && !episodeId) {
    if (!episodes[0]) notFound();
    redirect(`/watch/${movie.id}/${episodes[0].id}`);
  }
  const episode = episodeId ? episodes.find((e) => e.id === episodeId) : undefined;
  if (episodeId && !episode) notFound();
  const rights = movie.vip_required ? await entitlements(user?.id) : [],
    canPlay = !movie.vip_required || rights.includes("VIP_MOVIES");
  const media = canPlay ? await playback(movie.id, episode?.id) : { sources: [], subtitles: [] };
  return (
    <WatchScreen
      key={episode?.id || movie.id}
      movie={movie}
      episode={episode}
      episodes={episodes}
      sources={media.sources}
      subtitles={media.subtitles}
      canPlay={canPlay}
    />
  );
}
