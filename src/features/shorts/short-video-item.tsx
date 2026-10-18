"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Modal } from "@/components/ui";
import { preloadShort, type ShortVideo } from "@/domain/shorts";
import { ShortActions } from "./short-actions";
import { ShortMetadata } from "./short-metadata";
import { ShortCommentsSheet } from "./short-comments-sheet";
import { ShortShareSheet } from "./short-share-sheet";

export function ShortVideoItem({
  item,
  index,
  activeIndex,
  visible,
  muted,
  onMute,
  register,
  allowPlayback,
}: {
  item: ShortVideo;
  index: number;
  activeIndex: number;
  visible: boolean;
  muted: boolean;
  onMute: () => void;
  register: (id: string, element: HTMLVideoElement | null) => void;
  allowPlayback: (id: string, element: HTMLVideoElement) => boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const progress = useRef<HTMLProgressElement>(null);
  const playVersion = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [feedback, setFeedback] = useState<"play" | "pause" | null>(null);
  const [panel, setPanel] = useState<"comments" | "credits" | "share" | null>(null);
  const active = index === activeIndex;
  const canRun = active && visible && !panel;
  const latestCanRun = useRef(canRun);
  latestCanRun.current = canRun;
  const hasSource = index === activeIndex || index === activeIndex + 1;
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    register(item.id, player);
    return () => {
      player.pause();
      register(item.id, null);
    };
  }, [item.id, register]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const version = ++playVersion.current;
    if (player.readyState >= 2) setReady(true);
    function resume() {
      if (!canRun || document.hidden) {
        player!.pause();
        return;
      }
      void player!
        .play()
        .then(() => {
          // An older play promise may resolve after a newer effect has resumed playback.
          // Only current playback eligibility can stop the current player.
          if (!latestCanRun.current || document.hidden) player!.pause();
        })
        .catch(() => {
          if (version === playVersion.current) setBlocked(true);
        });
    }
    resume();
    document.addEventListener("visibilitychange", resume);
    return () => {
      playVersion.current++;
      player.pause();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [canRun]);
  useEffect(() => {
    if (!hasSource) {
      video.current?.load();
      if (progress.current) progress.current.value = 0;
      setReady(false);
    }
  }, [hasSource]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 450);
    return () => clearTimeout(timer);
  }, [feedback]);
  async function togglePlay() {
    const player = video.current;
    if (!player || !active) return;
    if (player.paused) {
      try {
        await player.play();
        setFeedback("play");
        setBlocked(false);
      } catch {
        setBlocked(true);
      }
    } else {
      player.pause();
      setFeedback("pause");
    }
  }
  function updateProgress() {
    const player = video.current;
    if (player && progress.current && Number.isFinite(player.duration)) {
      progress.current.max = player.duration;
      progress.current.value = player.currentTime;
    }
  }
  return (
    <section
      className={`short-item ${active ? "is-active" : ""}`}
      data-index={index}
      data-active={active}
      aria-label={`Phim ngắn ${index + 1}: ${item.title}`}
    >
      <video
        ref={video}
        src={hasSource ? item.video_url : undefined}
        poster={hasSource ? item.thumbnail_url || undefined : undefined}
        preload={preloadShort(index, activeIndex)}
        muted={muted}
        playsInline
        loop
        autoPlay={canRun}
        onPlay={() => {
          const player = video.current;
          if (player && allowPlayback(item.id, player)) {
            setPlaying(true);
            setReady(true);
            setBlocked(false);
          }
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={updateProgress}
        onLoadedMetadata={updateProgress}
        onLoadedData={() => {
          setReady(true);
          setFailed(false);
        }}
        onCanPlay={() => setReady(true)}
        onError={() => {
          if (hasSource) setFailed(true);
        }}
        aria-label={`Video ngắn ${item.title}`}
      >
        Trình duyệt của bạn chưa hỗ trợ video.
      </video>
      <div className="short-shade" />
      <button
        className="short-tap"
        onClick={togglePlay}
        aria-label={playing ? "Tạm dừng video" : "Phát video"}
        tabIndex={active ? 0 : -1}
      >
        {feedback ? (
          <span className="short-play-feedback" key={feedback}>
            {feedback === "play" ? (
              <Play size={32} fill="currentColor" />
            ) : (
              <Pause size={32} fill="currentColor" />
            )}
          </span>
        ) : null}
      </button>
      {active && (!ready || failed || blocked) ? (
        <div className="short-player-status" role="status">
          {failed ? (
            <>
              <span>Chưa tải được video</span>
              <button
                onClick={() => {
                  setFailed(false);
                  video.current?.load();
                  void togglePlay();
                }}
              >
                Thử lại
              </button>
            </>
          ) : blocked ? (
            <button onClick={togglePlay}>
              <Play size={18} />
              Chạm để phát
            </button>
          ) : (
            <span>Đang tải video…</span>
          )}
        </div>
      ) : null}
      <div className="short-top">
        <span>
          Phim ngắn <small>Đề xuất</small>
        </span>
        <button
          className="short-icon"
          aria-label={muted ? "Bật âm thanh" : "Tắt âm thanh"}
          onClick={onMute}
          tabIndex={active ? 0 : -1}
        >
          {muted ? <VolumeX size={23} /> : <Volume2 size={23} />}
        </button>
      </div>
      <ShortActions
        shortId={item.id}
        active={active}
        onComments={() => setPanel("comments")}
        onShare={() => setPanel("share")}
      />
      <ShortMetadata item={item} active={active} onCredits={() => setPanel("credits")} />
      <progress
        ref={progress}
        className="short-progress"
        value={0}
        max={item.duration_seconds || 1}
        aria-label="Tiến độ video"
      />
      {panel === "comments" ? <ShortCommentsSheet onClose={() => setPanel(null)} /> : null}
      {panel === "share" ? <ShortShareSheet item={item} onClose={() => setPanel(null)} /> : null}
      {panel === "credits" ? (
        <Modal title="Nguồn video" onClose={() => setPanel(null)}>
          {item.source_type === "DEMO" ? (
            <>
              <p>
                Clip mẫu Big Buck Bunny, © 2008 Blender Foundation / www.bigbuckbunny.org. Đã cắt
                đoạn, thêm nền mờ và chuyển sang khung dọc; không phải trích đoạn của phim liên kết.
              </p>
              <p>
                <a href="https://peach.blender.org/about/" target="_blank" rel="noreferrer">
                  Nguồn gốc
                </a>{" "}
                ·{" "}
                <a
                  href="https://creativecommons.org/licenses/by/3.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 3.0
                </a>
              </p>
            </>
          ) : (
            <p>
              {item.creator_name || "CineVjet"} · {item.source}. Nội dung do quản trị viên cung cấp.
            </p>
          )}
        </Modal>
      ) : null}
    </section>
  );
}
