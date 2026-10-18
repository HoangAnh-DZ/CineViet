import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { digest, newSession, throttleAuth, registrationEmailIdentity } from "./auth-core";
import { credentialsSchema } from "./validation";
import { ApiError } from "./http";
type Tx = Parameters<Parameters<ReturnType<typeof database>["transaction"]>[0]>[0];
const password = credentialsSchema.shape.password;
const currentPassword = z.string().min(1).max(1000);
const nameInput = z.object({ display_name: z.string().trim().min(2).max(80) }).strict();
const passwordInput = z
  .object({ current_password: currentPassword, new_password: password, confirm_password: password })
  .strict()
  .refine((v) => v.new_password === v.confirm_password, {
    message: "Mật khẩu nhập lại không khớp.",
    path: ["confirm_password"],
  });
const emailInput = z
  .object({ email: credentialsSchema.shape.email, current_password: currentPassword })
  .strict();
const tokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const emailVerificationAvailable = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.ACCOUNT_EMAIL_FROM);
async function audit(tx: Tx, user: string, action: string, detail: Record<string, unknown> = {}) {
  await tx.execute(
    sql`INSERT INTO cinevjet.account_security_audit(id,user_id,action,detail) VALUES(${randomUUID()},${user},${action},${JSON.stringify(detail)}::jsonb)`,
  );
}
async function lockUser(tx: Tx, actor: string, token: string) {
  const row = (
    await tx.execute(
      sql`SELECT u.* FROM cinevjet.users u WHERE u.id=${actor} AND u.status='ACTIVE' FOR UPDATE`,
    )
  ).rows[0];
  const valid = (
    await tx.execute(
      sql`SELECT 1 FROM cinevjet.sessions WHERE user_id=${actor} AND token_hash=${digest(token)} AND expires_at>now()`,
    )
  ).rows.length;
  if (!row || !valid) throw new ApiError(401, "Vui lòng đăng nhập lại.");
  return row;
}
async function rotate(tx: Tx, actor: string) {
  const session = newSession(false);
  await tx.execute(sql`DELETE FROM cinevjet.sessions WHERE user_id=${actor}`);
  await tx.execute(
    sql`INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES(${session.id},${actor},${session.tokenHash},${session.expires})`,
  );
  return session;
}
function userDto(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    username: String(row.display_name),
    email: String(row.email),
    ...(row.avatar_url ? { avatar: String(row.avatar_url) } : {}),
  };
}
export async function updateDisplayName(actor: string, raw: unknown) {
  const v = nameInput.parse(raw);
  await throttleAuth(`account-name:${actor}`, 20, 60);
  return database().transaction(async (tx) => {
    const r = (
      await tx.execute(
        sql`UPDATE cinevjet.users SET display_name=${v.display_name},updated_at=now() WHERE id=${actor} AND status='ACTIVE' RETURNING *`,
      )
    ).rows[0];
    if (!r) throw new ApiError(401, "Vui lòng đăng nhập lại.");
    await audit(tx, actor, "DISPLAY_NAME_CHANGED");
    return { user: userDto(r) };
  });
}
export async function changePassword(actor: string, token: string, raw: unknown) {
  const v = passwordInput.parse(raw);
  await throttleAuth(`account-password:${actor}`, 6, 60);
  const nextHash = await hash(v.new_password, 12);
  return database().transaction(async (tx) => {
    const r = await lockUser(tx, actor, token);
    if (!(await compare(v.current_password, String(r.password_hash))))
      throw new ApiError(400, "Không xác nhận được mật khẩu hiện tại.");
    await tx.execute(
      sql`UPDATE cinevjet.users SET password_hash=${nextHash},updated_at=now() WHERE id=${actor}`,
    );
    await tx.execute(
      sql`UPDATE cinevjet.email_change_requests SET used_at=now() WHERE user_id=${actor} AND used_at IS NULL`,
    );
    await audit(tx, actor, "PASSWORD_CHANGED");
    return { user: userDto(r), session: await rotate(tx, actor) };
  });
}
async function ensureEmailAvailable(tx: Tx, actor: string, email: string) {
  const identity = registrationEmailIdentity(email);
  // Same advisory identity lock for concurrent email changes, plus the registration lock.
  const key = digest(`registration-identity:${identity}`);
  await tx.execute(
    sql`INSERT INTO cinevjet.auth_limits(key,attempts,window_start) VALUES(${key},0,now()) ON CONFLICT(key) DO UPDATE SET attempts=cinevjet.auth_limits.attempts`,
  );
  const found = (
    await tx.execute(
      sql`SELECT 1 FROM cinevjet.users WHERE id<>${actor} AND (email=${email} OR (${identity.endsWith("@gmail.com")} AND lower(split_part(email,'@',2)) IN ('gmail.com','googlemail.com') AND replace(split_part(split_part(lower(email),'@',1),'+',1),'.','')=${identity.split("@")[0]})) LIMIT 1`,
    )
  ).rows.length;
  if (found) throw new ApiError(400, "Không thể sử dụng email này.");
}
export async function requestEmailChange(
  actor: string,
  token: string,
  raw: unknown,
  origin: string,
) {
  const v = emailInput.parse(raw);
  await throttleAuth(`account-email:${actor}`, 3, 60);
  if (!emailVerificationAvailable())
    throw new ApiError(503, "Đổi email chưa khả dụng. Vui lòng liên hệ hỗ trợ.");
  const code = randomBytes(32).toString("base64url"),
    id = randomUUID();
  await database().transaction(async (tx) => {
    const r = await lockUser(tx, actor, token);
    if (!(await compare(v.current_password, String(r.password_hash))))
      throw new ApiError(400, "Không xác nhận được mật khẩu hiện tại.");
    if (r.email === v.email) throw new ApiError(400, "Vui lòng nhập email mới.");
    await ensureEmailAvailable(tx, actor, v.email);
    await tx.execute(
      sql`UPDATE cinevjet.email_change_requests SET used_at=now() WHERE user_id=${actor} AND used_at IS NULL`,
    );
    await tx.execute(
      sql`INSERT INTO cinevjet.email_change_requests(id,user_id,new_email,token_hash,credential_hash,expires_at) VALUES(${id},${actor},${v.email},${digest("email-change:" + code)},${digest(String(r.password_hash))},now()+interval '15 minutes')`,
    );
    await audit(tx, actor, "EMAIL_CHANGE_REQUESTED");
  });
  const link = new URL("/profile", origin);
  link.searchParams.set("panel", "account");
  link.searchParams.set("email_token", code);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "email-change/" + id,
      },
      body: JSON.stringify({
        from: process.env.ACCOUNT_EMAIL_FROM,
        to: [v.email],
        subject: "CineVjet — Xác minh email mới",
        text: `Mở liên kết để xác nhận email mới (15 phút): ${link.toString()}\nNếu không yêu cầu, hãy bỏ qua email này.`,
      }),
    });
    if (!response.ok || typeof (await response.json()).id !== "string")
      throw new Error("Mail unavailable");
    await database().execute(
      sql`UPDATE cinevjet.email_change_requests SET sent_at=now() WHERE id=${id} AND used_at IS NULL`,
    );
  } catch {
    throw new ApiError(503, "Chưa gửi được email xác minh. Email hiện tại được giữ nguyên.");
  }
  return { message: "Đã gửi liên kết xác minh đến email mới." };
}
export async function confirmEmailChange(actor: string, token: string, raw: unknown) {
  const v = tokenInput.parse(raw);
  await throttleAuth(`account-email-confirm:${actor}`, 10, 60);
  try {
    return await database().transaction(async (tx) => {
      const user = await lockUser(tx, actor, token);
      const r = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.email_change_requests WHERE user_id=${actor} AND token_hash=${digest("email-change:" + v.token)} FOR UPDATE`,
        )
      ).rows[0];
      if (
        !r ||
        r.used_at ||
        !r.sent_at ||
        new Date(String(r.expires_at)).getTime() <= Date.now() ||
        r.credential_hash !== digest(String(user.password_hash))
      )
        throw new ApiError(400, "Liên kết không hợp lệ hoặc đã hết hạn.");
      await ensureEmailAvailable(tx, actor, String(r.new_email));
      const changed = (
        await tx.execute(
          sql`UPDATE cinevjet.users SET email=${r.new_email},updated_at=now() WHERE id=${actor} RETURNING *`,
        )
      ).rows[0];
      await tx.execute(
        sql`UPDATE cinevjet.email_change_requests SET used_at=now() WHERE user_id=${actor} AND used_at IS NULL`,
      );
      await audit(tx, actor, "EMAIL_CHANGED", {
        previous_email: user.email,
        new_email: r.new_email,
      });
      return { user: userDto(changed), session: await rotate(tx, actor) };
    });
  } catch (e) {
    if (
      (e as { cause?: { code?: string }; code?: string }).code === "23505" ||
      (e as { cause?: { code?: string } }).cause?.code === "23505"
    )
      throw new ApiError(400, "Không thể sử dụng email này.");
    throw e;
  }
}
