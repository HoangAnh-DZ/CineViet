"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Flag,
  Share2,
  ChevronLeft,
  ChevronRight,
  Cast,
  Captions,
} from "lucide-react";
import type { Movie, Episode, VideoSource, Subtitle } from "@/domain/models";
import { EpisodeSelector, FavoriteButton } from "@/components/movies";
import { IconButton, Modal, SectionHeader } from "@/components/ui";
import { VideoPlayerShell } from "./video-player-shell";
import { useApp } from "@/components/providers";
import { MovieCredit } from "@/components/movie-credit";
import { autoSource, lowerSource } from "@/domain/playback";
import { episodeDuration, episodeHeading } from "@/domain/episodes";
export function WatchScreen({
  movie,
  episode,
  episodes,
  sources,
  subtitles,
  canPlay,
}: {
  movie: Movie;
  episode?: Episode;
  episodes: Episode[];
  sources: VideoSource[];
  subtitles: Subtitle[];
  canPlay: boolean;
}) {
  const { toast } = useApp();
  const [subtitle, setSubtitle] = useState("");
  const [report, setReport] = useState(false);
  const [issue, setIssue] = useState("Không phát được video");
  const [sourceId, setSourceId] = useState("AUTO");
  const [autoId, setAutoId] = useState(
    () =>
      autoSource(
        sources,
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { connection?: { downlink?: number; saveData?: boolean } })
              .connection,
      )?.id,
  );
  const selectedSource =
    sources.find((source) => source.id === (sourceId === "AUTO" ? autoId : sourceId)) ?? sources[0];
  function reduceQuality() {
    if (sourceId !== "AUTO" || !selectedSource) return false;
    const lower = lowerSource(sources, selectedSource);
    if (!lower) return false;
    setAutoId(lower.id);
    return true;
  }
  const index = episodes.findIndex((e) => e.id === episode?.id);
  async function copyVideoIssue() {
    try {
      await navigator.clipboard.writeText(
        [
          `CineVjet · ${movie.title}`,
          `Vấn đề: ${issue}`,
          ...(episode ? [episodeHeading(episode)] : []),
          `Trang: ${window.location.origin}${window.location.pathname}`,
        ].join("\n"),
      );
      setReport(false);
      toast("Đã sao chép thông tin lỗi. Bạn có thể gửi cho bộ phận hỗ trợ.");
    } catch {
      toast("Chưa sao chép được. Hãy gửi tên phim và lỗi cho bộ phận hỗ trợ.");
    }
  }
  async function share() {
    try {
      const url = new URL(window.location.pathname + window.location.search, window.location.origin)
        .href;
      if (navigator.share) await navigator.share({ title: movie.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Đã sao chép liên kết");
      }
    } catch {
      toast("Chưa thể chia sẻ. Bạn có thể sao chép địa chỉ trang.");
    }
  }
  return (
    <>
      <div className="player-topbar">
        <Link href={`/movie/${movie.slug}`} className="icon-button" aria-label="Quay lại chi tiết">
          <ArrowLeft size={20} />
        </Link>
        <div className="player-options">
          <IconButton
            label="Truyền màn hình"
            onClick={() => toast("Truyền màn hình sẽ khả dụng khi kết nối bộ phát.")}
          >
            <Cast size={19} />
          </IconButton>
          <select
            aria-label="Chất lượng video"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="AUTO">Tự động</option>
            {sources
              .filter((source) => source.quality !== "AUTO")
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.quality.toUpperCase()}
                </option>
              ))}
          </select>
          <Captions size={19} />
          <select
            aria-label="Phụ đề"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          >
            <option value="">Tắt</option>
            {subtitles.map((s) => (
              <option key={s.id} value={s.language}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {canPlay && selectedSource ? (
        <VideoPlayerShell
          source={selectedSource}
          subtitles={subtitles}
          subtitle={subtitle}
          poster={movie.backdrop}
          movieId={movie.id}
          episodeId={episode?.id}
          movie={movie}
          episodeNumber={episode?.episode_number}
          onBufferTimeout={reduceQuality}
        />
      ) : (
        <div className="empty-state">
          <h2>{canPlay ? "Video chưa sẵn sàng" : "Phim dành cho thành viên VIP"}</h2>
          <p>{canPlay ? "Vui lòng thử lại sau." : "Nâng cấp để mở khóa bộ phim này."}</p>
          <Link className="button primary" href={canPlay ? `/movie/${movie.slug}` : "/vip"}>
            {canPlay ? "Chi tiết phim" : "Khám phá gói VIP"}
          </Link>
        </div>
      )}
      <div className="content watch-content">
        <div className="watch-heading">
          <h1>{movie.title}</h1>
          {episode ? (
            <>
              <h2 className="watch-episode-title">{episodeHeading(episode)}</h2>
              {episodeDuration(episode.duration) ? (
                <p>{episodeDuration(episode.duration)}</p>
              ) : null}
              {episode.description?.trim() ? (
                <details className="watch-episode-synopsis">
                  <summary>Nội dung tập</summary>
                  <p>{episode.description}</p>
                </details>
              ) : null}
            </>
          ) : movie.original_title && movie.original_title !== movie.title ? (
            <p>{movie.original_title}</p>
          ) : null}
        </div>
        <div className="watch-actions">
          <div className="watch-favorite">
            <FavoriteButton movieId={movie.id} />
            <span>Thích</span>
          </div>
          <button onClick={() => toast("Tải xuống chưa khả dụng trong phiên trải nghiệm.")}>
            <Download size={20} />
            Tải xuống
          </button>
          <button onClick={() => setReport(true)}>
            <Flag size={20} />
            Báo lỗi
          </button>
          <button onClick={share}>
            <Share2 size={20} />
            Chia sẻ
          </button>
        </div>
        {episode ? (
          <>
            <div className="episode-arrows">
              {index > 0 ? (
                <Link
                  className="button secondary"
                  href={`/watch/${movie.id}/${episodes[index - 1].id}`}
                >
                  <ChevronLeft size={15} />
                  Tập trước
                </Link>
              ) : (
                <button className="button secondary" disabled>
                  <ChevronLeft size={15} />
                  Tập trước
                </button>
              )}
              {index < episodes.length - 1 ? (
                <Link
                  className="button secondary"
                  href={`/watch/${movie.id}/${episodes[index + 1].id}`}
                >
                  Tập sau
                  <ChevronRight size={15} />
                </Link>
              ) : (
                <button className="button secondary" disabled>
                  Tập sau
                </button>
              )}
            </div>
            <section className="section-block">
              <SectionHeader title="Danh sách tập" />
              <EpisodeSelector movie={movie} episodes={episodes} selected={episode.id} compact />
            </section>
          </>
        ) : null}
        <section className="section-block">
          <SectionHeader title="Thông tin phim" />
          <div className="info-movie">
            <img src={movie.poster} alt={movie.title} />
            <div>
              <h3>{movie.title}</h3>
              {movie.original_title && movie.original_title !== movie.title ? (
                <p>{movie.original_title}</p>
              ) : null}
              <p>
                {[
                  movie.release_year || null,
                  movie.duration ? `${movie.duration} phút` : null,
                  movie.country,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="genre-tags">
                {movie.genres.map((g) => (
                  <span key={g}>{g}</span>
                ))}
              </div>
            </div>
          </div>
          <p className="description section-block">{movie.description || "Chưa có mô tả."}</p>
        </section>
        <MovieCredit
          movie={selectedSource?.credit ? { ...movie, ...selectedSource.credit } : movie}
        />
      </div>
      {report ? (
        <Modal title="Báo lỗi video" onClose={() => setReport(false)}>
          <label className="field-label" htmlFor="video-issue">
            Vấn đề gặp phải
          </label>
          <select
            id="video-issue"
            className="field"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
          >
            <option>Không phát được video</option>
            <option>Phụ đề không hiển thị</option>
            <option>Âm thanh bị lỗi</option>
          </select>
          <button className="button primary wide" onClick={copyVideoIssue}>
            Sao chép thông tin lỗi
          </button>
        </Modal>
      ) : null}
    </>
  );
}
