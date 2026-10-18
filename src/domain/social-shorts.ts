import { z } from "zod";
export const MAX_NEW_VIDEOS_PER_DAY = 5;
export const DEFAULT_TARGET_NEW_VIDEOS = 3;
export const MAX_IMPORT_URLS = 30;
export type SocialProvider = "TIKTOK" | "FACEBOOK";
export function parseSocialVideo(value: string) {
  const u = new URL(value.trim());
  if (u.protocol !== "https:" || u.username || u.password || u.port || value.length > 2048)
    throw new Error("Chỉ nhận URL HTTPS gốc từ TikTok hoặc Facebook.");
  let provider: SocialProvider,
    id: string,
    originalUrl: string,
    creatorUrl: string | null = null;
  const tik = u.pathname.match(/^\/@([a-zA-Z0-9._]{1,30})\/video\/(\d{10,25})\/?$/);
  if (["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(u.hostname) && tik) {
    provider = "TIKTOK";
    id = tik[2];
    creatorUrl = `https://www.tiktok.com/@${tik[1].toLowerCase()}`;
    originalUrl = `${creatorUrl}/video/${id}`;
  } else if (
    ["www.facebook.com", "facebook.com", "m.facebook.com", "web.facebook.com"].includes(u.hostname)
  ) {
    provider = "FACEBOOK";
    const reel = u.pathname.match(/^\/reel\/(\d{5,30})\/?$/),
      video = u.pathname.match(/^\/([a-zA-Z0-9._-]{1,100})\/videos\/(\d{5,30})\/?$/);
    if (reel) {
      id = reel[1];
      originalUrl = `https://www.facebook.com/reel/${id}/`;
    } else if (video) {
      id = video[2];
      creatorUrl = `https://www.facebook.com/${video[1]}`;
      originalUrl = `${creatorUrl}/videos/${id}/`;
    } else if (
      /^\/(watch\/?|video\.php)$/.test(u.pathname) &&
      /^\d{5,30}$/.test(u.searchParams.get("v") || "")
    ) {
      id = u.searchParams.get("v")!;
      originalUrl = `https://www.facebook.com/watch/?v=${id}`;
    } else throw new Error("Dùng URL video/reel gốc Facebook, không dùng link rút gọn.");
  } else throw new Error("Dùng URL video gốc TikTok/Facebook, không dùng link rút gọn.");
  return {
    provider,
    providerVideoId: id,
    originalUrl,
    creatorUrl,
    embedUrl:
      provider === "TIKTOK"
        ? `https://www.tiktok.com/player/v1/${id}?autoplay=0&controls=1&description=1&music_info=1`
        : `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(originalUrl)}&show_text=true&autoplay=false`,
  };
}
export function parseSocialSource(value: string, provider: SocialProvider) {
  const u = new URL(value.trim());
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("URL tác giả không hợp lệ.");
  const pattern =
    provider === "TIKTOK" ? /^\/@[a-zA-Z0-9._]{1,30}\/?$/ : /^\/[a-zA-Z0-9._-]{1,100}\/?$/;
  const hosts =
    provider === "TIKTOK" ? ["www.tiktok.com", "tiktok.com"] : ["www.facebook.com", "facebook.com"];
  if (!hosts.includes(u.hostname) || !pattern.test(u.pathname))
    throw new Error("Nhập URL trang tác giả đúng nền tảng.");
  return `https://www.${provider === "TIKTOK" ? "tiktok" : "facebook"}.com${u.pathname.replace(/\/$/, "")}`.toLowerCase();
}
export const socialSourceInput = z
  .object({
    id: z.string().uuid().optional(),
    provider: z.enum(["TIKTOK", "FACEBOOK"]),
    source_url: z.string().max(2048),
    creator_name: z.string().trim().min(1).max(100),
    authorization_status: z.enum(["PENDING", "VERIFIED", "REJECTED"]),
    permission_evidence: z.string().trim().max(1500),
    sync_enabled: z.boolean(),
    confirm_rights: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      v.authorization_status !== "VERIFIED" ||
      (v.confirm_rights && v.permission_evidence.length >= 12),
    "Cần xác nhận quyền phù hợp và ghi căn cứ cho phép sử dụng.",
  );
export const socialImportInput = z
  .object({
    source_id: z.string().uuid(),
    urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(MAX_IMPORT_URLS),
  })
  .strict();
export const socialReviewInput = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(["APPROVE", "HIDE", "REJECT"]),
    permission_evidence: z.string().trim().max(1500).default(""),
    confirm_rights: z.boolean().default(false),
    title: z.string().trim().min(1).max(160).optional(),
    creator_name: z.string().trim().min(1).max(100).optional(),
    embed_confirmed: z.boolean().default(false),
  })
  .strict();
export const socialErrorLabel = (code: string | null) =>
  ({
    RATE_LIMITED: "Nền tảng giới hạn lượt gọi; chờ lần đồng bộ sau.",
    UNAVAILABLE: "Video đã bị gỡ hoặc không còn nhúng được.",
    NEEDS_REVIEW: "Cần kiểm tra trực tiếp trình phát chính thức.",
    PROVIDER_ERROR: "Chưa xác minh được video với nền tảng.",
    INVALID_METADATA: "Metadata từ nền tảng chưa hợp lệ.",
    RIGHTS_REQUIRED: "Chưa xác minh quyền sử dụng.",
    EXPIRED: "Đã hết thời gian đồng bộ 30 ngày.",
  })[code || ""] ||
  code ||
  "";
