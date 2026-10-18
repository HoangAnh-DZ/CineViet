"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import type { Movie, Subtitle, VideoSource, WatchProgress } from "@/domain/models";
import { IconButton } from "@/components/ui";
import { useApp } from "@/components/providers";
import { useWatchRewards } from "./use-watch-rewards";
import {
  BUFFER_SPINNER_DELAY_MS,
  BUFFER_TIMEOUT_MS,
  NETWORK_RETRY_DELAYS,
} from "@/domain/playback";
export interface PlaybackAdapter {
  supports(source: VideoSource): boolean;
  attach(element: HTMLVideoElement, source: VideoSource): () => void;
}
// Register HLS/DASH adapters here without changing screen components.
export const nativePlaybackAdapter: PlaybackAdapter = {
  supports: (source) => ["MP4", "WEBM"].includes(source.protocol),
  attach(video, source) {
    video.src = source.url;
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
  onBufferTimeout,
}: {
  source: VideoSource;
  subtitles: Subtitle[];
  subtitle: string;
  poster: string;
  movieId: string;
  episodeId?: string;
  movie: Movie;
  episodeNumber?: number;
  onBufferTimeout?: () => boolean;
}) {
  const { saveProgress, progress, toast, hydrated } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  useWatchRewards(video, source.id);
  const shell = useRef<HTMLDivElement>(null);
  const lastSave = useRef(0);
  const resumed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const timeoutCallback = useRef(onBufferTimeout);
  timeoutCallback.current = onBufferTimeout;
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0),
    wanted = useRef(false),
    reloading = useRef(false);
  const lastPosition = useRef(0);
  const handoff = useRef<{ position: number; playing: boolean } | null>(null);
  const lastSavedPosition = useRef(-1);
  const pendingSave = useRef<WatchProgress | null>(null),
    saving = useRef(false);
  function drainSave() {
    if (saving.current || !pendingSave.current) return;
    const item = pendingSave.current;
    pendingSave.current = null;
    saving.current = true;
    Promise.resolve(saveRef.current(item))
      .catch(() => {})
      .finally(() => {
        saving.current = false;
        drainSave();
      });
  }
  function save(force = false) {
    const media = video.current;
    if (!media || !Number.isFinite(media.duration) || media.currentTime <= 0) return;
    if (Math.abs(media.currentTime - lastSavedPosition.current) < 0.25) return;
    if (!force && Date.now() - lastSave.current < 15000) return;
    lastSave.current = Date.now();
    lastSavedPosition.current = media.currentTime;
    pendingSave.current = {
      user_id: "",
      movie,
      episode_number: episodeNumber,
      movie_id: movieId,
      episode_id: episodeId,
      position_seconds: Math.min(media.currentTime, media.duration),
      duration_seconds: media.duration,
      updated_at: new Date().toISOString(),
    };
    drainSave();
  }
  function clearWaiting() {
    if (waitTimer.current) clearTimeout(waitTimer.current);
    if (stallTimer.current) clearTimeout(stallTimer.current);
    if (qualityTimer.current) clearTimeout(qualityTimer.current);
    qualityTimer.current = null;
    waitTimer.current = null;
    stallTimer.current = null;
    setLoading(false);
  }
  function beginWaiting(initial = false) {
    const media = video.current;
    if (!media || media.ended || (!initial && media.paused && !media.seeking)) return;
    if (waitTimer.current || stallTimer.current) return;
    waitTimer.current = setTimeout(() => {
      waitTimer.current = null;
      setLoading(true);
    }, BUFFER_SPINNER_DELAY_MS);
    qualityTimer.current = setTimeout(() => {
      if (navigator.onLine && timeoutCallback.current?.()) clearWaiting();
    }, 4000);
    stallTimer.current = setTimeout(() => {
      clearWaiting();
      if (!timeoutCallback.current?.())
        setError(
          navigator.onLine
            ? "Video đang tải chậm. Kiểm tra kết nối hoặc thử lại tại vị trí hiện tại."
            : "Bạn đang mất kết nối. Kết nối lại mạng rồi bấm Thử lại.",
        );
    }, BUFFER_TIMEOUT_MS);
  }
  function retry(manual = false) {
    const media = video.current;
    if (!media) return;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (manual) retries.current = 0;
    handoff.current = {
      position: media.currentTime || lastPosition.current,
      playing: wanted.current,
    };
    reloading.current = true;
    clearWaiting();
    setError("");
    beginWaiting(true);
    media.load();
  }
  function mediaError() {
    clearWaiting();
    const code = video.current?.error?.code;
    if (
      code === MediaError.MEDIA_ERR_NETWORK &&
      navigator.onLine &&
      retries.current < NETWORK_RETRY_DELAYS.length
    ) {
      const delay = NETWORK_RETRY_DELAYS[retries.current++];
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        retry();
      }, delay);
    } else
      setError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE
          ? "Video hiện chưa phát được trên trình duyệt này. Vui lòng thử lại sau."
          : "Không tải được phim. Kiểm tra kết nối rồi thử lại; vị trí xem được giữ nguyên.",
      );
  }
  useEffect(() => {
    const media = video.current;
    if (!media) return;
    resumed.current = false;
    reloading.current = true;
    retries.current = 0;
    setError("");
    setDuration(0);
    beginWaiting(true);
    if (!nativePlaybackAdapter.supports(sourceRef.current)) {
      clearWaiting();
      setError("Video này chưa được trình duyệt hỗ trợ. Vui lòng thử lại sau.");
      return;
    }
    const detach = nativePlaybackAdapter.attach(media, sourceRef.current);
    return () => {
      handoff.current = {
        position: media.currentTime || lastPosition.current,
        playing: wanted.current,
      };
      save(true);
      reloading.current = true;
      clearWaiting();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      detach();
    };
    // Stable media identity: saving progress, controls and new object references never reload the source.
  }, [source.id, source.url, source.protocol, movieId, episodeId]);
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
  useEffect(() => {
    const flush = () => save(true);
    const online = () => {
      if (
        video.current?.error?.code === MediaError.MEDIA_ERR_NETWORK &&
        retries.current < NETWORK_RETRY_DELAYS.length
      ) {
        retries.current++;
        retry();
      }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", online);
    };
  }, [movieId, episodeId]);
  async function toggle() {
    const media = video.current;
    if (!media) return;
    try {
      if (media.paused) {
        wanted.current = true;
        await media.play();
      } else {
        wanted.current = false;
        media.pause();
      }
    } catch {
      clearWaiting();
      setError("Chưa phát được phim. Bấm Phát để thử lại.");
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (shell.current?.requestFullscreen) await shell.current.requestFullscreen();
      else
        (
          video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
        )?.webkitEnterFullscreen?.();
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
        aria-label={`Phim ${movie.title}`}
        onLoadStart={() => beginWaiting(true)}
        onWaiting={() => beginWaiting()}
        onStalled={() => {
          if (video.current && video.current.readyState < 3) beginWaiting();
        }}
        onSeeking={() => beginWaiting(true)}
        onSeeked={() => {
          if (video.current && video.current.readyState >= 3) clearWaiting();
        }}
        onCanPlay={() => {
          clearWaiting();
        }}
        onPlaying={() => {
          clearWaiting();
          setError("");
        }}
        onLoadedMetadata={() => {
          const media = video.current!;
          setDuration(media.duration);
          const resume = handoff.current;
          handoff.current = null;
          if (resume) {
            resumed.current = true;
            if (resume.position > 0 && resume.position < media.duration - 1) {
              media.currentTime = resume.position;
              setPosition(resume.position);
            }
            if (resume.playing)
              void media.play().catch(() => {
                wanted.current = false;
                setPlaying(false);
              });
          }
          reloading.current = false;
          for (const track of Array.from(media.textTracks))
            track.mode = track.language === subtitle ? "showing" : "disabled";
        }}
        onTimeUpdate={() => {
          const media = video.current!;
          if (media.currentTime > lastPosition.current + 0.05 && media.readyState >= 3)
            clearWaiting();
          lastPosition.current = media.currentTime;
          setPosition(media.currentTime);
          save();
        }}
        onPlay={() => {
          wanted.current = true;
          setPlaying(true);
          setError("");
        }}
        onPause={() => {
          if (!reloading.current && !video.current?.error) wanted.current = false;
          clearWaiting();
          setPlaying(false);
          save(true);
        }}
        onEnded={() => {
          wanted.current = false;
          clearWaiting();
          setPlaying(false);
          save(true);
        }}
        onError={mediaError}
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
      {loading && !error ? (
        <div className="video-loading" role="status">
          Đang tải phim…
        </div>
      ) : null}
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
              retry(true);
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
