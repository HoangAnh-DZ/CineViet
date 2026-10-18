"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Play, Heart, Bookmark, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Episode, Movie, WatchProgress } from "@/domain/models";
import { episodeDuration, episodeHeading } from "@/domain/episodes";
import { unoptimizedArtwork } from "@/domain/artwork";
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
        <Image
          src={movie.poster}
          alt={`Poster ${movie.title}`}
          fill
          sizes="(max-width: 599px) 40vw, (max-width: 999px) 25vw, 180px"
          unoptimized={unoptimizedArtwork(movie.poster)}
        />
        {movie.vip_required || movie.type === "SERIES" ? (
          <span className={`quality-badge ${movie.vip_required ? "vip" : ""}`}>
            {movie.vip_required ? "VIP" : `${movie.episode_count || 0} tập`}
          </span>
        ) : null}
        <span className="poster-play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
      </div>
      <h3 title={movie.title}>{movie.title}</h3>
      <p>
        {movie.release_year} · {movie.type === "SERIES" ? "Phim bộ" : `${movie.duration} phút`}
      </p>
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
export function MovieGridSkeleton() {
  return (
    <div className="movie-grid" role="status" aria-label="Đang tải phim">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="movie-card card-skeleton" key={i} aria-hidden="true">
          <div className="poster skeleton" />
          <div className="skeleton skeleton-card-title" />
          <div className="skeleton skeleton-card-meta" />
        </div>
      ))}
    </div>
  );
}
export function MovieRow({
  title,
  items,
  query = "",
  caption,
}: {
  title: string;
  items: Movie[];
  query?: string;
  caption?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  function updateEdges() {
    const el = row.current;
    if (!el) return;
    const next = {
      previous: el.scrollLeft > 2,
      next: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    };
    setEdges((previous) =>
      previous.previous === next.previous && previous.next === next.next ? previous : next,
    );
  }
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);
  function move(direction: number) {
    const el = row.current;
    if (el)
      el.scrollBy({
        left: direction * el.clientWidth * 0.85,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  if (!items.length) return null;
  return (
    <section className="movie-section">
      <div className="movie-row-heading">
        <SectionHeader title={title} href={`/explore${query}`} />
        <div className="row-controls">
          <IconButton label={`${title}: Trước`} disabled={!edges.previous} onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label={`${title}: Tiếp`} disabled={!edges.next} onClick={() => move(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>
      {caption ? <p className="row-caption">{caption}</p> : null}
      <div className="movie-row" ref={row} onScroll={updateEdges}>
        {items.map((movie) => (
          <MovieCard movie={movie} key={movie.id} />
        ))}
      </div>
    </section>
  );
}
export function RankedMovieRow({ items }: { items: Movie[] }) {
  return (
    <section className="movie-section ranked-section">
      <SectionHeader title="Khám phá thêm" href="/explore?sort=newest" />
      <div className="ranked-row">
        {items.map((movie, index) => (
          <div className="ranked-card" key={movie.id}>
            <span className="rank-number" aria-label={`Hạng ${index + 1}`}>
              {index + 1}
            </span>
            <MovieCard movie={movie} />
          </div>
        ))}
      </div>
    </section>
  );
}
export function FavoriteButton({
  movieId,
  className = "",
  showLabel = false,
}: {
  movieId: string;
  className?: string;
  showLabel?: boolean;
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
      {showLabel ? (
        <>
          <Bookmark size={19} fill={active ? "currentColor" : "none"} />
          <span>{active ? "Đã lưu" : "Danh sách"}</span>
        </>
      ) : (
        <Heart size={21} fill={active ? "currentColor" : "none"} />
      )}
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
      <div className="continue-image">
        <Image
          src={movie.backdrop}
          alt={movie.title}
          fill
          sizes="(max-width: 599px) 75vw, 340px"
          unoptimized={unoptimizedArtwork(movie.backdrop)}
        />
        <span className="continue-icon" aria-hidden="true">
          <Play size={24} fill="currentColor" />
        </span>
        <WatchProgressBar
          position={progress.position_seconds}
          duration={progress.duration_seconds}
        />
      </div>
      <div className="continue-info">
        <h3>{movie.title}</h3>
        <p>
          {episode
            ? `Tập ${episode}${movie.episode_count ? "/" + movie.episode_count : ""}`
            : "Tiếp tục xem"}
        </p>
      </div>
    </Link>
  );
}
export function HeroMovie({ items: heroMovies }: { items: Movie[] }) {
  const [index, setIndex] = useState(0);
  const selected = Math.min(index, Math.max(0, heroMovies.length - 1));
  const movie = heroMovies[selected];
  if (!movie) return null;
  return (
    <section
      className="hero cinematic-hero"
      aria-label="Phim nổi bật"
      aria-roledescription="băng chuyền"
    >
      <Image
        className="hero-image"
        src={movie.backdrop}
        alt={movie.title}
        fill
        sizes="(max-width: 1440px) 100vw, 1440px"
        preload={selected === 0}
        unoptimized={unoptimizedArtwork(movie.backdrop)}
      />
      <div className="hero-shade" />
      <div className="hero-copy">
        <span className="eyebrow">
          <span className="live-accent" /> TIÊU ĐIỂM CINEVJET
        </span>
        <h2 aria-live="polite">{movie.title}</h2>
        <div className="metadata">
          <span>{movie.release_year}</span>
          <span>•</span>
          <span>
            {Math.floor(movie.duration / 60)}h {movie.duration % 60}m
          </span>
          <span>•</span>
          {movie.rating != null && movie.rating > 0 ? (
            <>
              <RatingBadge rating={movie.rating} />
              <span>•</span>
            </>
          ) : null}
          <span>
            {movie.type === "SERIES" ? `${movie.episode_count || 0} tập` : movie.genres[0]}
          </span>
        </div>
        <p>{movie.description}</p>
        <div className="hero-buttons">
          <Link className="button primary" href={`/watch/${movie.id}`}>
            <Play size={18} fill="currentColor" aria-hidden="true" /> Xem ngay
          </Link>
          <Link className="button secondary" href={`/movie/${movie.slug}`}>
            <Info size={18} aria-hidden="true" /> Chi tiết
          </Link>
        </div>
      </div>
      <div className="hero-pagination">
        <span className="hero-counter">
          {String(selected + 1).padStart(2, "0")}
          <span> / {String(heroMovies.length).padStart(2, "0")}</span>
        </span>
        <div className="hero-dots" aria-label="Chọn phim nổi bật">
          {heroMovies.map((m, i) => (
            <button
              key={m.id}
              aria-label={`Phim nổi bật ${i + 1}`}
              aria-pressed={i === selected}
              className={i === selected ? "active" : ""}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        {heroMovies.length > 1 ? (
          <div className="hero-arrows">
            <IconButton
              label="Phim nổi bật trước"
              onClick={() => setIndex((selected - 1 + heroMovies.length) % heroMovies.length)}
            >
              <ChevronLeft size={20} />
            </IconButton>
            <IconButton
              label="Phim nổi bật tiếp theo"
              onClick={() => setIndex((selected + 1) % heroMovies.length)}
            >
              <ChevronRight size={20} />
            </IconButton>
          </div>
        ) : null}
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
  const { progress } = useApp();
  const current = selected ?? progress.find((p) => p.movie_id === movie.id)?.episode_id;
  return (
    <div className={`episode-selector episode-list ${compact ? "compact" : ""}`}>
      {episodes.map((episode) => {
        const id = episode.id;
        return (
          <Link
            key={id}
            href={`/watch/${movie.id}/${id}`}
            className={`episode-card ${current === id ? "selected" : ""} ${episode.thumbnail ? "" : "without-thumbnail"}`}
            aria-current={current === id ? "page" : undefined}
          >
            {episode.thumbnail ? (
              <span className="episode-thumbnail">
                <img
                  src={episode.thumbnail}
                  alt=""
                  width={320}
                  height={180}
                  loading="lazy"
                  decoding="async"
                />
                <Play size={18} aria-hidden="true" />
              </span>
            ) : null}
            <div className="episode-copy">
              <h3>{episodeHeading(episode)}</h3>
              <div className="episode-meta">
                {episodeDuration(episode.duration) ? (
                  <span>{episodeDuration(episode.duration)}</span>
                ) : null}
                {current === id ? <span className="episode-current">Đang xem</span> : null}
              </div>
              {episode.description?.trim() ? (
                <p className="episode-description">{episode.description}</p>
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
