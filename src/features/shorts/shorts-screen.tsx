"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import type { ShortsBatch } from "@/domain/shorts";
import { loadShorts } from "@/services/shorts";
import { ShortVideoItem } from "./short-video-item";
import { EmbeddedShortItem } from "./embedded-short-item";
import "./social-shorts.css";

export function ShortsScreen({
  initialBatch,
  selectedId,
}: {
  initialBatch: ShortsBatch;
  selectedId?: string;
}) {
  const [items, setItems] = useState(initialBatch.items);
  const [nextCursor, setNextCursor] = useState(initialBatch.nextCursor);
  const [activeIndex, setActiveIndex] = useState(
    Math.max(
      0,
      initialBatch.items.findIndex((item) => item.id === selectedId),
    ),
  );
  const [visible, setVisible] = useState(true);
  const [muted, setMuted] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const feed = useRef<HTMLDivElement>(null);
  const players = useRef(new Map<string, HTMLVideoElement>());
  const activeId = useRef(items[activeIndex]?.id);
  const activeVisible = useRef(true);
  const initialized = useRef(false);
  const register = useCallback((id: string, player: HTMLVideoElement | null) => {
    if (player) players.current.set(id, player);
    else players.current.delete(id);
  }, []);
  const allowPlayback = useCallback((id: string, player: HTMLVideoElement) => {
    if (activeId.current !== id || !activeVisible.current || document.hidden) {
      player.pause();
      return false;
    }
    for (const [otherId, other] of players.current) if (otherId !== id) other.pause();
    return true;
  }, []);
  useEffect(() => {
    const root = feed.current;
    if (!root) return;
    if (!initialized.current) {
      initialized.current = true;
      const index = Math.max(
        0,
        initialBatch.items.findIndex((item) => item.id === selectedId),
      );
      root.scrollTop = index * root.clientHeight;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const candidate = entries
          .filter((entry) => entry.intersectionRatio >= 0.65)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (candidate) {
          const index = Number((candidate.target as HTMLElement).dataset.index);
          activeId.current = items[index].id;
          activeVisible.current = true;
          for (const [id, player] of players.current) if (id !== activeId.current) player.pause();
          setActiveIndex(index);
          setVisible(true);
        } else if (
          entries.some(
            (entry) =>
              items[Number((entry.target as HTMLElement).dataset.index)]?.id === activeId.current &&
              entry.intersectionRatio < 0.65,
          )
        ) {
          activeVisible.current = false;
          for (const player of players.current.values()) player.pause();
          setVisible(false);
        }
      },
      { root, threshold: [0, 0.65] },
    );
    root.querySelectorAll<HTMLElement>(".short-item").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [items, initialBatch.items, selectedId]);
  useEffect(() => {
    if (!nextCursor || activeIndex < items.length - 2) return;
    const controller = new AbortController();
    setLoadError("");
    void loadShorts(nextCursor, controller.signal)
      .then((batch) => {
        if (controller.signal.aborted) return;
        setItems((current) => [
          ...current,
          ...batch.items.filter((item) => !current.some((existing) => existing.id === item.id)),
        ]);
        setNextCursor(batch.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError("Chưa tải được video tiếp theo.");
      });
    return () => controller.abort();
  }, [activeIndex, items.length, nextCursor, retry]);
  function toggleMute() {
    const next = !muted;
    for (const player of players.current.values()) player.muted = next;
    setMuted(next);
  }
  return items.length ? (
    <div ref={feed} className="shorts-feed" aria-label="Video ngắn" tabIndex={0}>
      {items.map((item, index) =>
        item.source_type === "EMBED" ? (
          <EmbeddedShortItem
            key={item.id}
            item={item}
            index={index}
            activeIndex={activeIndex}
            visible={visible}
          />
        ) : (
          <ShortVideoItem
            key={item.id}
            item={item}
            index={index}
            activeIndex={activeIndex}
            visible={visible}
            muted={muted}
            onMute={toggleMute}
            register={register}
            allowPlayback={allowPlayback}
          />
        ),
      )}
      {loadError ? (
        <div className="short-feed-error" role="status">
          {loadError}
          <button onClick={() => setRetry((value) => value + 1)}>Thử lại</button>
        </div>
      ) : null}
    </div>
  ) : (
    <div className="content">
      <EmptyState
        title="Phim ngắn đang được chuẩn bị"
        body="Khám phá những câu chuyện trong kho phim CineVjet."
      >
        <Link className="button primary" href="/explore">
          Khám phá phim
        </Link>
      </EmptyState>
    </div>
  );
}
