"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import type { Episode, Movie } from "@/domain/models";
import { FavoriteButton, EpisodeSelector, MovieRow } from "@/components/movies";
import { Modal, RatingBadge, SectionHeader } from "@/components/ui";
export function MovieDetail({
  movie,
  episodes,
  related,
  previewUrl,
}: {
  movie: Movie;
  episodes: Episode[];
  related: Movie[];
  previewUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [trailer, setTrailer] = useState(false);
  return (
    <>
      <div className="detail-visual">
        <img className="detail-backdrop" src={movie.backdrop} alt={movie.title} />
        <div className="detail-shade" />
        <div className="detail-topbar">
          <Link href="/" className="icon-button" aria-label="Quay lại">
            <ArrowLeft size={21} />
          </Link>
          <FavoriteButton movieId={movie.id} />
        </div>
      </div>
      <div className="detail-summary">
        <div className="detail-poster">
          <img src={movie.poster} alt={`Poster ${movie.title}`} />
          <span className="poster-title">{movie.original_title}</span>
        </div>
        <div>
          <h1>{movie.title}</h1>
          <p className="original-title">{movie.original_title}</p>
          <div className="metadata">
            <RatingBadge rating={movie.rating} />
            <span>• {movie.release_year}</span>
            <span>
              • {Math.floor(movie.duration / 60)}h {movie.duration % 60}m
            </span>
          </div>
          <div className="genre-tags">
            {movie.genres.map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
          <p className="country">Quốc gia: {movie.country}</p>
        </div>
      </div>
      <div className="content">
        <div className="detail-actions">
          <Link
            className="button primary"
            href={movie.vip_required ? "/vip" : `/watch/${movie.id}`}
          >
            {movie.vip_required ? "Xem với VIP" : "Xem ngay"}
          </Link>
          <button
            className="button secondary"
            disabled={!previewUrl}
            onClick={() => setTrailer(true)}
          >
            <Play size={15} /> Trailer
          </button>
          <FavoriteButton movieId={movie.id} />
        </div>
        <section>
          <SectionHeader title="Mô tả phim" />
          <p className={`description ${expanded ? "" : "clamped"}`}>{movie.description}</p>
          <button className="text-button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Thu gọn" : "Xem thêm"}
          </button>
        </section>
        {movie.type === "SERIES" ? (
          <section className="section-block">
            <SectionHeader
              title="Danh sách tập"
              action={<span className="metadata">Vietsub⌄</span>}
            />
            <EpisodeSelector movie={movie} episodes={episodes} />
          </section>
        ) : null}
        <MovieRow title="Phim liên quan" items={related} />
      </div>
      {trailer ? (
        <Modal title="Trailer mẫu" onClose={() => setTrailer(false)}>
          <video controls playsInline autoPlay src={previewUrl} />
          <p className="sample-credit">Big Buck Bunny · Blender Foundation · CC BY 3.0</p>
        </Modal>
      ) : null}
    </>
  );
}
