"use client";
import { useEffect, useState } from "react";
import { Bookmark, ExternalLink, PlaySquare } from "lucide-react";
import { useApp } from "@/components/providers";
import { parseSocialVideo } from "@/domain/social-shorts";
import type { ShortVideo } from "@/domain/shorts";
export function EmbeddedShortItem({
  item,
  index,
  activeIndex,
  visible,
}: {
  item: ShortVideo;
  index: number;
  activeIndex: number;
  visible: boolean;
}) {
  const [documentVisible, setDocumentVisible] = useState(true),
    [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  const { savedShortIds, toggleSavedShort, hydrated } = useApp();
  const active = index === activeIndex,
    mount = active && visible && documentVisible;
  let video: ReturnType<typeof parseSocialVideo> | null = null;
  try {
    video = parseSocialVideo(item.original_url || "");
    if (video.embedUrl !== item.embed_url) video = null;
  } catch {}
  useEffect(() => {
    const change = () => setDocumentVisible(!document.hidden);
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!mount) {
      setLoaded(false);
      setFailed(false);
    }
  }, [mount]);
  const saved = savedShortIds.includes(item.id);
  return (
    <section
      className={`short-item embedded-short ${active ? "is-active" : ""}`}
      data-index={index}
      data-active={active}
      aria-label={`Phim ngắn ${index + 1}: ${item.title}`}
    >
      <div className="social-player-stage">
        {mount && video && !failed ? (
          <>
            {!loaded ? (
              <div className="social-embed-loading" role="status">
                Đang tải trình phát {item.source}…
              </div>
            ) : null}
            <iframe
              key={item.id}
              title={`${item.source}: ${item.title}`}
              src={video.embedUrl}
              allow="fullscreen; picture-in-picture; encrypted-media"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-top-navigation-by-user-activation"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        ) : (
          <div className="social-embed-placeholder">
            <PlaySquare size={40} />
            <span>{failed ? "Trình phát chưa khả dụng" : item.source}</span>
          </div>
        )}
      </div>
      <footer className="social-short-caption">
        <div className="social-short-heading">
          <span>
            {item.source} · {item.creator_name}
          </span>
          <button
            className="short-icon"
            aria-label={saved ? "Bỏ lưu video" : "Lưu video"}
            aria-pressed={saved}
            disabled={!hydrated}
            tabIndex={active ? 0 : -1}
            onClick={() => void toggleSavedShort(item.id)}
          >
            <Bookmark size={20} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
        <h2>{item.title}</h2>
        {video ? (
          <a
            href={video.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={active ? 0 : -1}
          >
            Mở video gốc <ExternalLink size={14} />
          </a>
        ) : (
          <span>Video không còn khả dụng.</span>
        )}
      </footer>
    </section>
  );
}
