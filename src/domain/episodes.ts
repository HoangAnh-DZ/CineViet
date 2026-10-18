import type { Episode, Movie, WatchProgress } from "./models";

export function resumableProgress(movie: Movie, episodes: Episode[], progress: WatchProgress[]) {
  return progress.find(
    (p) =>
      p.movie_id === movie.id &&
      p.position_seconds > 0 &&
      p.position_seconds < p.duration_seconds - 5 &&
      (movie.type !== "SERIES" || episodes.some((e) => e.id === p.episode_id)),
  );
}

export function episodeHeading(episode: Episode) {
  const label = `${episode.season > 1 ? `Mùa ${episode.season} · ` : ""}Tập ${episode.episode_number}`;
  const title = episode.title?.trim();
  return title && !/^(?:tập|episode|chapter)\s*\d+$/i.test(title) ? `${label} — ${title}` : label;
}

export function episodeDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  return minutes
    ? `${minutes} phút${seconds % 60 ? ` ${Math.floor(seconds % 60)} giây` : ""}`
    : `${Math.floor(seconds)} giây`;
}
