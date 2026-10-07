"use client";
import Link from "next/link";
import { useState } from "react";
import { Play, Heart, Shuffle } from "lucide-react";
import type { Episode, Movie, WatchProgress } from "@/domain/models";
import { useApp } from "./providers";
import { RatingBadge, SectionHeader, IconButton } from "./ui";
export function WatchProgressBar({ position, duration }: { position: number; duration: number }) {
  return (
    <div
      className="watch-progress"
      role="progressbar"
      aria-label="Tiến độ xem"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, duration > 0 ? (position / duration) * 100 : 0))}
    >
      <span
        style={{ width: `${Math.min(100, duration > 0 ? (position / duration) * 100 : 0)}%` }}
      />
    </div>
  );
}
export function MovieCard({ movie }: { movie: Movie }) {
  return (
    <Link href={`/movie/${movie.slug}`} className="movie-card">
      <div className="poster">
        <img src={movie.poster} alt={`Poster ${movie.title}`} loading="lazy" />
        <span className="poster-title">{movie.original_title}</span>
        <span className={`quality-badge ${movie.vip_required ? "vip" : ""}`}>
          {movie.vip_required ? "VIP" : "Vietsub"}
        </span>
      </div>
      <h3>{movie.title}</h3>
      <p>{movie.release_year}</p>
    </Link>
  );
}
export function MovieGrid({ items }: { items: Movie[] }) {
  return (
    <div className="movie-grid">
      {items.map((movie) => (
        <MovieCard key={movie.id} movie={movie} />
      ))}
    </div>
  );
}
export function MovieRow({
  title,
  items,
  query = "",
}: {
  title: string;
  items: Movie[];
  query?: string;
}) {
  return (
    <section className="movie-section">
      <SectionHeader title={title} href={`/explore${query}`} />
      <div className="movie-row">
        {items.map((movie) => (
          <MovieCard movie={movie} key={movie.id} />
        ))}
      </div>
    </section>
  );
}
export function FavoriteButton({
  movieId,
  className = "",
}: {
  movieId: string;
  className?: string;
}) {
  const { favorites, toggleFavorite, hydrated } = useApp();
  const active = favorites.includes(movieId);
  return (
    <IconButton
      disabled={!hydrated}
      label={active ? "Bỏ yêu thích" : "Thêm yêu thích"}
      className={`${className} ${active ? "is-favorite" : ""}`}
      onClick={() => {
        toggleFavorite(movieId);
      }}
    >
      <Heart size={21} fill={active ? "currentColor" : "none"} />
    </IconButton>
  );
}
export function ContinueWatchingCard({ progress }: { progress: WatchProgress }) {
  const movie = progress.movie;
  if (!movie) return null;
  const episode = progress.episode_number;
  return (
    <Link
      href={`/watch/${movie.id}${progress.episode_id ? `/${progress.episode_id}` : ""}`}
      className="continue-card"
    >
      <img src={movie.backdrop} alt={movie.title} loading="lazy" />
      <div className="continue-info">
        <h3>{movie.title}</h3>
        <p>{episode ? `Tập ${episode}/${movie.episode_count}` : "Tiếp tục xem"}</p>
      </div>
      <Shuffle className="continue-icon" size={15} />
      <WatchProgressBar position={progress.position_seconds} duration={progress.duration_seconds} />
    </Link>
  );
}
export function HeroMovie({ items: heroMovies }: { items: Movie[] }) {
  const [index, setIndex] = useState(0);
  const movie = heroMovies[index];
  if (!movie) return null;
  return (
    <section className="hero">
      <img className="hero-image" src={movie.backdrop} alt={movie.title} fetchPriority="high" />
      <div className="hero-shade" />
      <div className="hero-copy">
        <h1>{movie.title}</h1>
        <div className="metadata">
          <span>{movie.release_year}</span>
          <span>•</span>
          <span>
            {Math.floor(movie.duration / 60)}h {movie.duration % 60}m
          </span>
          <span>•</span>
          <RatingBadge rating={movie.rating} />
          <span>•</span>
          <span>HD</span>
        </div>
        <p>{movie.description}</p>
        <div className="hero-buttons">
          <Link className="button primary" href={`/watch/${movie.id}`}>
            <Play size={15} /> Xem ngay
          </Link>
          <Link className="button secondary" href={`/movie/${movie.slug}`}>
            Chi tiết
          </Link>
        </div>
      </div>
      <div className="hero-dots" aria-label="Phim nổi bật">
        {heroMovies.map((m, i) => (
          <button
            key={m.id}
            aria-label={`Phim nổi bật ${i + 1}`}
            aria-pressed={i === index}
            className={i === index ? "active" : ""}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  );
}
export function EpisodeSelector({
  movie,
  episodes,
  selected,
  compact = false,
}: {
  movie: Movie;
  episodes: Episode[];
  selected?: string;
  compact?: boolean;
}) {
  return (
    <div className={`episode-selector ${compact ? "compact" : ""}`}>
      {episodes.map((episode) => {
        const id = episode.id;
        return (
          <Link
            key={id}
            href={`/watch/${movie.id}/${id}`}
            className={selected === id ? "selected" : ""}
            aria-current={selected === id ? "page" : undefined}
          >
            {compact
              ? episode.episode_number
              : `${episode.season > 1 ? `M${episode.season} · ` : ""}Tập ${episode.episode_number}`}
          </Link>
        );
      })}
    </div>
  );
}
