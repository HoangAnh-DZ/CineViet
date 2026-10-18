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
  verification_challenge: z.string().uuid("Mã xác minh không hợp lệ.").optional(),
  verification_code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4}$/, "Mã xác minh gồm 4 ký tự.")
    .optional(),
  referral_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,24}$/, "Mã giới thiệu không hợp lệ.")
    .optional()
    .or(z.literal("")),
});
export const registrationRequestSchema = registrationSchema.extend({
  verification_challenge: z.string().uuid("Mã xác minh không hợp lệ."),
  verification_code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{4}$/, "Mã xác minh gồm 4 ký tự."),
});
// UI-only confirmation extends the same server rules; it is never part of the API payload.
export const registrationFormSchema = registrationRequestSchema
  .extend({
    confirm_password: z.string().min(1, "Vui lòng nhập lại mật khẩu."),
  })
  .refine((data) => data.password === data.confirm_password, {
    path: ["confirm_password"],
    message: "Mật khẩu nhập lại không khớp",
  });
export const registrationChallengeSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(/^[A-Z0-9]{4}$/),
});
export const rewardCodeCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{6,32}$/)
    .optional(),
  reward_coins: z.coerce.number().int().min(1).max(1000000),
  max_redemptions: z.coerce.number().int().min(1).max(10000000).default(1),
  expires_at: z.string().datetime().nullable().optional(),
});
export const rewardCodeRedeemSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{6,32}$/),
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
