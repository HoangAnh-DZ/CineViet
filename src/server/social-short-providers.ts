import "server-only";
import { parseSocialVideo, parseSocialSource } from "@/domain/social-shorts";
export type EmbedCheck = {
  status: "AVAILABLE" | "UNAVAILABLE" | "NEEDS_REVIEW";
  error: string | null;
  title?: string;
  creator_name?: string;
  creator_url?: string;
  thumbnail_url?: string | null;
};
export async function verifySocialEmbed(row: Record<string, unknown>): Promise<EmbedCheck> {
  let video: ReturnType<typeof parseSocialVideo>;
  try {
    video = parseSocialVideo(String(row.original_url));
  } catch {
    return { status: "UNAVAILABLE", error: "INVALID_METADATA" };
  }
  if (
    video.provider !== row.provider ||
    video.providerVideoId !== row.provider_video_id ||
    video.embedUrl !== row.embed_url
  )
    return { status: "UNAVAILABLE", error: "INVALID_METADATA" };
  if (video.provider === "FACEBOOK") {
    // No account scraping or claim of automatic discovery. An admin must verify the official
    // public player and provide actual metadata. Reconfirmation expires after 48 hours.
    const confirmed = new Date(String(row.embed_confirmed_at || "")).getTime();
    return Number.isFinite(confirmed) &&
      confirmed > Date.now() - 48 * 3600000 &&
      !!row.title &&
      row.title !== row.original_url
      ? { status: "AVAILABLE", error: null }
      : { status: "NEEDS_REVIEW", error: "NEEDS_REVIEW" };
  }
  try {
    // Only this fixed official JSON endpoint is fetched. Never follow a supplied URL/redirect.
    const response = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(video.originalUrl)}`,
      { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(4000) },
    );
    if (response.status === 429) return { status: "NEEDS_REVIEW", error: "RATE_LIMITED" };
    if ([404, 410].includes(response.status))
      return { status: "UNAVAILABLE", error: "UNAVAILABLE" };
    if (!response.ok || !response.headers.get("content-type")?.includes("json"))
      return { status: "NEEDS_REVIEW", error: "PROVIDER_ERROR" };
    const reader = response.body?.getReader();
    if (!reader) return { status: "NEEDS_REVIEW", error: "INVALID_METADATA" };
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 131072) {
        await reader.cancel();
        throw Error("Response too large");
      }
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      data.type !== "video" ||
      data.provider_name !== "TikTok" ||
      typeof data.title !== "string" ||
      !data.title.trim() ||
      typeof data.author_name !== "string" ||
      !data.author_name.trim() ||
      typeof data.author_url !== "string"
    )
      return { status: "NEEDS_REVIEW", error: "INVALID_METADATA" };
    const creator = parseSocialSource(data.author_url, "TIKTOK");
    if (creator !== video.creatorUrl) return { status: "NEEDS_REVIEW", error: "INVALID_METADATA" };
    let thumbnail: string | null = null;
    if (typeof data.thumbnail_url === "string") {
      const t = new URL(data.thumbnail_url);
      if (
        t.protocol === "https:" &&
        !t.username &&
        !t.password &&
        ["tiktokcdn.com", "tiktokcdn-us.com", "muscdn.com", "byteoversea.com", "tiktok.com"].some(
          (h) => t.hostname === h || t.hostname.endsWith("." + h),
        )
      )
        thumbnail = t.href.slice(0, 2048);
    }
    // Never persist or execute provider HTML/scripts; the iframe URL is constructed locally.
    return {
      status: "AVAILABLE",
      error: null,
      title: data.title.trim().slice(0, 160),
      creator_name: data.author_name.trim().slice(0, 100),
      creator_url: creator,
      thumbnail_url: thumbnail,
    };
  } catch {
    return { status: "NEEDS_REVIEW", error: "PROVIDER_ERROR" };
  }
}
