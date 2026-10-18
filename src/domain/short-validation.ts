import { z } from "zod";
// Blob's documented maximum individual file size. Multipart upload bypasses Function body limits.
export const MAX_UPLOAD_BYTES = 5_000_000_000_000;
export const uploadTypes = {
  video: { mp4: "video/mp4", webm: "video/webm" },
  thumbnail: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" },
} as const;
export function validUpload(kind: "video" | "thumbnail", name: string, mime: string, size: number) {
  const extension = name.toLowerCase().split(".").pop() || "";
  const types: Record<string, string> = uploadTypes[kind];
  return (
    !!types[extension] &&
    types[extension] === mime &&
    Number.isSafeInteger(size) &&
    size > 0 &&
    size <= MAX_UPLOAD_BYTES
  );
}
export function safeMediaUrl(value: string, kind: "video" | "thumbnail") {
  if (kind === "video" && /^\/video\/shorts\/bunny-[1-5]\.mp4$/.test(value)) return true;
  if (
    kind === "thumbnail" &&
    /^\/(?:images|video\/shorts)\/[a-zA-Z0-9._/-]+\.(?:jpg|jpeg|png|webp)$/.test(value) &&
    !value.includes("..")
  )
    return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (
      url.hostname === "localhost" ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(url.hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)
    )
      return false;
    return kind === "thumbnail" || /\.(?:mp4|webm)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
const optionalText = z.string().trim().max(500).nullable();
export const shortInput = z
  .object({
    title: z.string().trim().min(1, "Nhập tiêu đề video.").max(160),
    description: z.string().trim().max(2000),
    creator_name: z.string().trim().max(100).nullable(),
    movie_id: optionalText,
    episode_id: optionalText,
    video_url: z
      .string()
      .max(2048)
      .refine((v) => safeMediaUrl(v, "video"), "Video cần URL HTTPS .mp4 hoặc .webm hợp lệ."),
    thumbnail_url: z
      .string()
      .max(2048)
      .nullable()
      .refine((v) => !v || safeMediaUrl(v, "thumbnail"), "URL thumbnail không hợp lệ."),
    duration_seconds: z.number().int().positive().max(86400).nullable(),
    hashtags: z.array(z.string().trim().min(1).max(50)).max(20),
    display_order: z.number().int().min(-1_000_000).max(1_000_000),
    is_active: z.boolean(),
    source_type: z.enum(["UPLOAD", "EXTERNAL", "DEMO"]),
  })
  .strict()
  .refine((v) => !v.episode_id || !!v.movie_id, {
    message: "Chọn phim trước khi chọn tập.",
    path: ["episode_id"],
  });
export type ShortInput = z.infer<typeof shortInput>;
