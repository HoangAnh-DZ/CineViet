"use client";
import { useState } from "react";
import { Bookmark, Clapperboard, Heart, MessageCircle, Share2 } from "lucide-react";
import { useApp } from "@/components/providers";
export function ShortActions({
  active,
  onComments,
  onShare,
  shortId,
}: {
  active: boolean;
  onComments: () => void;
  onShare: () => void;
  shortId: string;
}) {
  const [liked, setLiked] = useState(false);
  const { savedShortIds, toggleSavedShort, hydrated } = useApp();
  const saved = savedShortIds.includes(shortId);
  const tabIndex = active ? 0 : -1;
  return (
    <div className="short-actions" aria-label="Tương tác video">
      <span className="short-channel" aria-label="CineVjet">
        <Clapperboard size={23} />
      </span>
      <button
        className={`short-icon ${liked ? "selected" : ""}`}
        aria-label="Thích video trong phiên này"
        aria-pressed={liked}
        tabIndex={tabIndex}
        onClick={() => setLiked((value) => !value)}
      >
        <Heart size={27} fill={liked ? "currentColor" : "none"} />
        <small>Thích</small>
      </button>
      <button
        className="short-icon"
        aria-label="Bình luận"
        tabIndex={tabIndex}
        onClick={onComments}
      >
        <MessageCircle size={27} />
        <small>Bình luận</small>
      </button>
      <button
        className={`short-icon ${saved ? "selected" : ""}`}
        aria-label={saved ? "Bỏ lưu video" : "Lưu video"}
        aria-pressed={saved}
        tabIndex={tabIndex}
        disabled={!hydrated}
        onClick={() => void toggleSavedShort(shortId)}
      >
        <Bookmark size={27} fill={saved ? "currentColor" : "none"} />
        <small>Lưu</small>
      </button>
      <button
        className="short-icon"
        aria-label="Chia sẻ video ngắn"
        tabIndex={tabIndex}
        onClick={onShare}
      >
        <Share2 size={26} />
        <small>Chia sẻ</small>
      </button>
    </div>
  );
}
