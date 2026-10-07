"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import type { Movie, Subtitle, VideoSource, WatchProgress } from "@/domain/models";
import { IconButton } from "@/components/ui";
import { useApp } from "@/components/providers";
export interface PlaybackAdapter {
  supports(source: VideoSource): boolean;
  attach(element: HTMLVideoElement, source: VideoSource): () => void;
}
// Register HLS/DASH adapters here without changing screen components.
export const nativePlaybackAdapter: PlaybackAdapter = {
  supports: (source) => source.protocol === "MP4",
  attach(video, source) {
    video.src = source.url;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  },
};
function timestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function VideoPlayerShell({
  source,
  subtitles,
  subtitle,
  poster,
  movieId,
  episodeId,
  movie,
  episodeNumber,
}: {
  source: VideoSource;
  subtitles: Subtitle[];
  subtitle: string;
  poster: string;
  movieId: string;
  episodeId?: string;
  movie: Movie;
  episodeNumber?: number;
}) {
  const { saveProgress, progress, toast, hydrated } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const lastSave = useRef(0);
  const resumed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  useEffect(() => {
    const media = video.current;
    if (!media) return;
    if (!nativePlaybackAdapter.supports(source)) {
      setError("Nguồn video cần bộ phát HLS/DASH.");
      return;
    }
    const detach = nativePlaybackAdapter.attach(media, source);
    return () => {
      if (Number.isFinite(media.duration) && media.currentTime > 0)
        saveRef.current({
          user_id: "",
          movie,
          episode_number: episodeNumber,
          movie_id: movieId,
          episode_id: episodeId,
          position_seconds: media.currentTime,
          duration_seconds: media.duration,
          updated_at: new Date().toISOString(),
        });
      detach();
    };
  }, [source, movieId, episodeId]);
  useEffect(() => {
    if (!hydrated || duration <= 0 || resumed.current || !video.current) return;
    resumed.current = true;
    const saved = progress.find((p) => p.movie_id === movieId && p.episode_id === episodeId);
    if (saved && saved.position_seconds > 0 && saved.position_seconds < duration - 2) {
      video.current.currentTime = saved.position_seconds;
      setPosition(saved.position_seconds);
    }
  }, [hydrated, duration, progress, movieId, episodeId]);
  useEffect(() => {
    if (!video.current) return;
    for (const track of Array.from(video.current.textTracks))
      track.mode = track.language === subtitle ? "showing" : "disabled";
  }, [subtitle]);
  useEffect(() => {
    function change() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  function save(force = false) {
    const media = video.current;
    if (!media || !Number.isFinite(media.duration) || media.currentTime <= 0) return;
    if (!force && Date.now() - lastSave.current < 15000) return;
    lastSave.current = Date.now();
    const item: WatchProgress = {
      user_id: "",
      movie,
      episode_number: episodeNumber,
      movie_id: movieId,
      episode_id: episodeId,
      position_seconds: Math.min(media.currentTime, media.duration),
      duration_seconds: media.duration,
      updated_at: new Date().toISOString(),
    };
    saveRef.current(item);
  }
  useEffect(() => {
    const media = video.current;
    const flush = () => {
      if (media && Number.isFinite(media.duration) && media.currentTime > 0)
        saveRef.current({
          user_id: "",
          movie,
          episode_number: episodeNumber,
          movie_id: movieId,
          episode_id: episodeId,
          position_seconds: media.currentTime,
          duration_seconds: media.duration,
          updated_at: new Date().toISOString(),
        });
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [movieId, episodeId]);
  async function toggle() {
    const media = video.current;
    if (!media) return;
    try {
      if (media.paused) await media.play();
      else media.pause();
    } catch {
      setError("Không phát được video mẫu. Vui lòng thử lại.");
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch {
      toast("Trình duyệt chưa hỗ trợ toàn màn hình.");
    }
  }
  return (
    <div className="video-shell" ref={shell}>
      <video
        ref={video}
        poster={poster}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedMetadata={() => {
          const media = video.current!;
          setDuration(media.duration);
          for (const track of Array.from(media.textTracks))
            track.mode = track.language === subtitle ? "showing" : "disabled";
        }}
        onTimeUpdate={() => {
          setPosition(video.current?.currentTime ?? 0);
          save();
        }}
        onPlay={() => {
          setPlaying(true);
          setError("");
        }}
        onPause={() => {
          setPlaying(false);
          save(true);
        }}
        onEnded={() => {
          setPlaying(false);
          save(true);
        }}
        onError={() => setError("Không tải được video mẫu. Kiểm tra kết nối và thử lại.")}
      >
        {subtitles.map((track) => (
          <track
            key={track.id}
            kind="subtitles"
            srcLang={track.language}
            label={track.label}
            src={track.url}
          />
        ))}
      </video>
      {!playing && !error ? (
        <button className="play-overlay" aria-label="Phát video" onClick={toggle}>
          <Play size={25} fill="currentColor" />
        </button>
      ) : null}
      {error ? (
        <div className="video-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              video.current?.load();
              setError("");
            }}
          >
            Thử lại
          </button>
        </div>
      ) : null}
      <div className="video-controls">
        <input
          className="seek-control"
          type="range"
          min={0}
          max={duration || 1}
          step="0.1"
          value={position}
          aria-label="Thời gian video"
          style={
            { "--seek-progress": `${duration ? (position / duration) * 100 : 0}%` } as CSSProperties
          }
          onChange={(e) => {
            if (video.current) {
              video.current.currentTime = Number(e.target.value);
              setPosition(Number(e.target.value));
              save(true);
            }
          }}
        />
        <div className="video-control-row">
          <div>
            <IconButton label={playing ? "Tạm dừng" : "Phát"} onClick={toggle}>
              {playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </IconButton>
            <span>
              {timestamp(position)} / {timestamp(duration)}
            </span>
          </div>
          <div>
            <div className="volume-control">
              <IconButton
                label={muted ? "Bật âm thanh" : "Tắt âm thanh"}
                onClick={() => {
                  if (video.current) video.current.muted = !muted;
                  setMuted(!muted);
                }}
              >
                {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </IconButton>
              <input
                type="range"
                className="volume-range"
                aria-label="Âm lượng"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setVolume(next);
                  setMuted(next === 0);
                  if (video.current) {
                    video.current.volume = next;
                    video.current.muted = next === 0;
                  }
                }}
              />
            </div>
            <IconButton
              label={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
