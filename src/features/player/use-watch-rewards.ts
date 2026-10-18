"use client";
import { useEffect, type RefObject } from "react";
import { useApp } from "@/components/providers";
import { WATCH_HEARTBEAT_MS } from "@/domain/watch-rewards";
type Session = { session_id: string; nonce: string };
// Separate from resume/history: client positions alone never qualify for rewards.
export function useWatchRewards(video: RefObject<HTMLVideoElement | null>, sourceId: string) {
  const { user } = useApp();
  useEffect(() => {
    const element = video.current;
    if (!element || !user?.id) return;
    const media = element;
    let session: Session | null = null,
      disposed = false,
      blocked = false;
    let queue = Promise.resolve();
    const eligible = () =>
      !media.paused &&
      !media.ended &&
      !media.seeking &&
      media.readyState >= 3 &&
      document.visibilityState === "visible" &&
      media.playbackRate === 1;
    async function send(playing: boolean, position: number) {
      if (disposed || blocked || (!session && !playing) || !Number.isFinite(position)) return;
      try {
        const response = await fetch("/api/rewards/watch", {
          method: session ? "PUT" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            session ? { ...session, position, playing } : { source_id: sourceId, position },
          ),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || response.status === 400)
            blocked = true;
          session = null;
          return;
        }
        session = (await response.json()) as Session;
      } catch {
        // Playback continues. A lost response cannot create credit: the next start needs a fresh lease.
        session = null;
      }
    }
    function sample(forceStop = false) {
      // Read at dispatch, so a slow request never queues old positions into a later interval/day.
      queue = queue.then(() => send(!forceStop && eligible(), media.currentTime));
    }
    const play = () => sample();
    const stop = () => sample(true);
    const visibility = () => sample(document.visibilityState !== "visible");
    const rate = () => sample(true); // Changing speed invalidates the current interval.
    function release() {
      if (session)
        void fetch("/api/rewards/watch", {
          method: "PUT",
          credentials: "same-origin",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...session, position: media.currentTime, playing: false }),
        }).catch(() => {});
    }
    media.addEventListener("playing", play);
    for (const event of ["pause", "waiting", "seeking", "ended", "error", "emptied"])
      media.addEventListener(event, stop);
    media.addEventListener("ratechange", rate);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", release);
    const timer = window.setInterval(() => sample(), WATCH_HEARTBEAT_MS);
    if (eligible()) sample();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      media.removeEventListener("playing", play);
      for (const event of ["pause", "waiting", "seeking", "ended", "error", "emptied"])
        media.removeEventListener(event, stop);
      media.removeEventListener("ratechange", rate);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [video, sourceId, user?.id]);
}
