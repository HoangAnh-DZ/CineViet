import { z } from "zod";
import { safeMediaUrl } from "./short-validation";
const image = z
  .string()
  .max(2048)
  .refine((v) => safeMediaUrl(v, "thumbnail"), "Ảnh cần URL HTTPS hoặc ảnh hiện có.");
const https = z
  .string()
  .max(2048)
  .refine(
    (v) => !v || (/^https:\/\//.test(v) && safeMediaUrl(v, "thumbnail")),
    "Liên kết cần HTTPS.",
  );
const video = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      !v ||
      (safeMediaUrl(v, "video") &&
        /\.(mp4|webm)$/i.test(new URL(v, "https://cinevjet.test").pathname)),
    "Nguồn phát cần URL MP4 hoặc WebM HTTPS.",
  );
export const episodeInput = z
  .object({
    id: z.string().min(1).max(100).optional(),
    season: z.number().int().min(1).max(100),
    episode_number: z.number().int().min(1).max(10000),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(3000).optional(),
    duration_seconds: z.number().int().min(1).max(86400),
    thumbnail_url: image.optional(),
    release_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]),
    playback_url: video,
  })
  .superRefine((e, ctx) => {
    if (e.status === "PUBLISHED" && !e.playback_url)
      ctx.addIssue({
        code: "custom",
        path: ["playback_url"],
        message: "Tập phát hành cần nguồn video.",
      });
  });
export const movieInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    original_title: z.string().trim().max(160),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
    description: z.string().trim().max(3000),
    poster_url: image,
    backdrop_url: image,
    release_year: z.number().int().min(1888).max(2200),
    country: z.string().trim().min(1).max(80),
    duration_minutes: z.number().int().min(1).max(10000),
    duration_seconds: z.number().int().min(1).max(86400).nullable().optional(),
    rating: z.number().min(0).max(10).nullable().default(null),
    type: z.enum(["MOVIE", "SERIES"]),
    status: z.enum(["DRAFT", "PUBLISHED", "HIDDEN"]),
    vip_required: z.boolean(),
    playback_url: video.optional(),
    language: z.string().trim().max(100).default(""),
    license_name: z.string().trim().max(160).default(""),
    license_url: https.default(""),
    license_source_url: https.default(""),
    source_page_url: https.default(""),
    attribution: z.string().trim().max(1000).default(""),
    poster_attribution: z.string().trim().max(1000).default(""),
    genres: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
    episodes: z.array(episodeInput).max(300).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.status === "PUBLISHED") {
      for (const field of [
        "description",
        "language",
        "license_name",
        "license_url",
        "license_source_url",
        "source_page_url",
        "attribution",
        "poster_attribution",
      ] as const)
        if (!m[field])
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "Bổ sung metadata, giấy phép và ghi công trước khi phát hành.",
          });
      if (m.type === "SERIES" && m.episodes && !m.episodes.some((e) => e.status === "PUBLISHED"))
        ctx.addIssue({
          code: "custom",
          path: ["episodes"],
          message: "Phim bộ cần ít nhất một tập có nguồn phát.",
        });
    }
    const positions = new Set<string>();
    for (const episode of m.episodes || []) {
      const key = `${episode.season}:${episode.episode_number}`;
      if (positions.has(key))
        ctx.addIssue({ code: "custom", path: ["episodes"], message: "Thứ tự tập bị trùng." });
      positions.add(key);
    }
    if (m.type === "MOVIE" && m.episodes?.length)
      ctx.addIssue({
        code: "custom",
        path: ["episodes"],
        message: "Chỉ phim bộ có danh sách tập.",
      });
  });
export type MovieInput = z.infer<typeof movieInput>;
