import { z } from "zod";
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Email không hợp lệ.")),
  password: z
    .string()
    .min(8, "Mật khẩu cần ít nhất 8 ký tự.")
    .refine((s) => new TextEncoder().encode(s).length <= 72, "Mật khẩu tối đa 72 byte."),
  remember: z.boolean().optional().default(true),
});
export const registrationSchema = credentialsSchema.extend({
  display_name: z.string().trim().min(2, "Tên cần ít nhất 2 ký tự.").max(80),
});
export const progressSchema = z
  .object({
    movie_id: z.string().min(1).max(100),
    episode_id: z.string().min(1).max(100).optional(),
    position_seconds: z.number().finite().min(0).max(86400),
    duration_seconds: z.number().finite().min(1).max(86400),
  })
  .refine((p) => p.position_seconds <= p.duration_seconds, "Tiến độ vượt quá thời lượng video.");
export const favoriteSchema = z.object({
  movie_id: z.string().min(1).max(100),
  active: z.boolean(),
});
export const catalogSchema = z.object({
  q: z.string().max(120).default(""),
  genre: z.string().max(80).default("Tất cả"),
  country: z.string().max(80).default(""),
  year: z
    .string()
    .regex(/^$|^\d{4}$/)
    .default(""),
  type: z.enum(["", "MOVIE", "SERIES"]).default(""),
  sort: z.enum(["", "newest", "rating"]).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
