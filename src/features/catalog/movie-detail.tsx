"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Play } from "lucide-react";
import type { Episode, Movie } from "@/domain/models";
import { unoptimizedArtwork } from "@/domain/artwork";
import { FavoriteButton, EpisodeSelector, MovieRow } from "@/components/movies";
import { RatingBadge, SectionHeader } from "@/components/ui";
import { MovieCredit } from "@/components/movie-credit";
import { useApp } from "@/components/providers";
import { resumableProgress } from "@/domain/episodes";
export function MovieDetail({
  movie,
  episodes,
  related,
}: {
  movie: Movie;
  episodes: Episode[];
  related: Movie[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { progress, entitlements } = useApp();
  const saved = resumableProgress(movie, episodes, progress);
  const requiresVip = movie.vip_required && !entitlements.includes("VIP_MOVIES");
  const watchHref = `/watch/${movie.id}${saved?.episode_id ? `/${saved.episode_id}` : ""}`;
  return (
    <article className="cinematic-detail">
      <div className="detail-visual">
        <Image
          className="detail-backdrop"
          src={movie.backdrop}
          alt={movie.title}
          fill
          sizes="(max-width: 1440px) 100vw, 1440px"
          preload
          unoptimized={unoptimizedArtwork(movie.backdrop)}
        />
        <div className="detail-shade" />
        <div className="detail-topbar">
          <Link href="/" className="icon-button" aria-label="Quay lại">
            <ArrowLeft size={21} />
          </Link>
          <span className="detail-type">{movie.type === "SERIES" ? "Phim bộ" : "Phim lẻ"}</span>
        </div>
        <div className="detail-summary">
          <div className="detail-poster">
            <Image
              src={movie.poster}
              alt={`Poster ${movie.title}`}
              fill
              sizes="(max-width: 599px) 104px, 180px"
              unoptimized={unoptimizedArtwork(movie.poster)}
            />
          </div>
          <div>
            <h1>{movie.title}</h1>
            {movie.original_title && movie.original_title !== movie.title ? (
              <p className="original-title">{movie.original_title}</p>
            ) : null}
            <div className="metadata">
              <RatingBadge rating={movie.rating} />
              <span>• {movie.release_year}</span>
              <span>
                • {movie.type === "SERIES" ? `${episodes.length} tập` : `${movie.duration} phút`}
              </span>
            </div>
            <div className="genre-tags">
              {movie.genres.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
            <p className="country">{[movie.country, movie.language].filter(Boolean).join(" · ")}</p>
            <div className="detail-actions">
              <Link className="button primary" href={requiresVip ? "/vip" : watchHref}>
                <Play size={18} fill="currentColor" aria-hidden="true" />
                {requiresVip
                  ? "Xem với VIP"
                  : saved
                    ? "Xem tiếp"
                    : movie.type === "SERIES"
                      ? "Xem tập đầu"
                      : "Xem ngay"}
              </Link>
              <FavoriteButton
                movieId={movie.id}
                className="button secondary detail-save"
                showLabel
              />
            </div>
          </div>
        </div>
      </div>
      <div className="content detail-content">
        <section className="detail-synopsis">
          <SectionHeader title="Câu chuyện" />
          <p
            id="movie-description"
            className={`description ${expanded || movie.description.length <= 180 ? "" : "clamped"}`}
          >
            {movie.description}
          </p>
          {movie.description.length > 180 ? (
            <button
              className="text-button"
              aria-expanded={expanded}
              aria-controls="movie-description"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Thu gọn" : "Xem thêm"}
            </button>
          ) : null}
        </section>
        {movie.type === "SERIES" ? (
          <section className="section-block">
            <SectionHeader title="Danh sách tập" />
            <EpisodeSelector movie={movie} episodes={episodes} selected={saved?.episode_id} />
          </section>
        ) : null}
        <MovieCredit movie={movie} />
        <MovieRow title="Phim liên quan" items={related} />
      </div>
    </article>
  );
}
