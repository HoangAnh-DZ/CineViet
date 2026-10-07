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
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const selectedSource = sources.find((source) => source.id === sourceId) ?? sources[0];
  const current = episode?.episode_number ?? 1;
  const index = episodes.findIndex((e) => e.id === episode?.id);
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: movie.title, url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
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
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.quality.toUpperCase()}
              </option>
            ))}
            <option disabled>1080P · VIP</option>
            <option disabled>4K · VIP</option>
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
        />
      ) : (
        <div className="empty-state">
          <h2>{canPlay ? "Chưa có nguồn phát" : "Phim dành cho thành viên VIP"}</h2>
          <p>{canPlay ? "Nguồn video đang được cập nhật." : "Nâng cấp để mở khóa bộ phim này."}</p>
          <Link className="button primary" href="/vip">
            Khám phá gói VIP
          </Link>
        </div>
      )}
      <div className="content">
        <div className="watch-heading">
          <h1>{movie.title}</h1>
          <p>{episode ? `Tập ${String(current).padStart(2, "0")}` : movie.original_title}</p>
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
              <SectionHeader
                title="Danh sách tập"
                action={<span className="metadata">Vietsub ›</span>}
              />
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
              <p>
                {movie.release_year} • {movie.duration} phút • {movie.country}
              </p>
              <div className="genre-tags">
                {movie.genres.map((g) => (
                  <span key={g}>{g}</span>
                ))}
              </div>
            </div>
          </div>
          <p className="description section-block">{movie.description}</p>
        </section>
        <p className="sample-credit">
          Video mẫu:{" "}
          <a href="https://peach.blender.org/" target="_blank" rel="noreferrer">
            Big Buck Bunny
          </a>{" "}
          · Blender Foundation · CC BY 3.0.
        </p>
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
          <button
            className="button primary wide"
            onClick={() => {
              setReport(false);
              toast("Đã ghi nhận phản hồi trong phiên trải nghiệm.");
            }}
          >
            Gửi phản hồi demo
          </button>
        </Modal>
      ) : null}
    </>
  );
}
