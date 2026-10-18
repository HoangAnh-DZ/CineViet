import "server-only";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { hash, compare } from "bcryptjs";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { credentialsSchema, registrationSchema, registrationChallengeSchema } from "./validation";
import type { User } from "@/domain/models";
import { registrationImage } from "./registration-image";
type UserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  password_hash: string;
  status: string;
};
export const sessionCookie =
  process.env.NODE_ENV === "production" ? "__Host-cinevjet_session" : "cinevjet_session";
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
export function digest(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET cần tối thiểu 32 ký tự.");
  return createHmac("sha256", secret).update(value).digest("hex");
}
const challengeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomChallengeCode(length = 4) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => challengeAlphabet[b % challengeAlphabet.length]).join("");
}
function randomReferralCode() {
  return `CVJ-${randomBytes(5).toString("hex").toUpperCase()}`;
}
export async function createRegistrationChallenge() {
  const id = randomUUID(),
    code = randomChallengeCode(),
    expires = new Date(Date.now() + 5 * 60 * 1000);
  const image = await registrationImage(code);
  await database().execute(
    sql`INSERT INTO cinevjet.registration_challenges(id,code_hash,expires_at) VALUES(${id},${digest(`${id}:${code}`)},${expires})`,
  );
  return { id, image, expires_at: expires.toISOString() };
}
export async function verifyRegistrationChallenge(input: unknown) {
  const data = registrationChallengeSchema.parse(input);
  const failure = await database().transaction(async (tx) => {
    const row = (
      await tx.execute(
        sql`SELECT id,code_hash,attempts,expires_at,used_at FROM cinevjet.registration_challenges WHERE id=${data.id} FOR UPDATE`,
      )
    ).rows[0] as Record<string, unknown> | undefined;
    if (!row || row.used_at || new Date(String(row.expires_at)).getTime() <= Date.now())
      return new ApiError(400, "Mã xác minh đã hết hạn. Hãy lấy mã mới.");
    if (Number(row.attempts) >= 5)
      return new ApiError(429, "Mã xác minh đã bị khóa. Hãy lấy mã mới.");
    const valid = digest(`${data.id}:${data.code}`) === String(row.code_hash);
    if (!valid) {
      await tx.execute(
        sql`UPDATE cinevjet.registration_challenges SET attempts=attempts+1 WHERE id=${data.id}`,
      );
      return new ApiError(400, "Mã xác minh không đúng.");
    }
    await tx.execute(
      sql`UPDATE cinevjet.registration_challenges SET used_at=now() WHERE id=${data.id}`,
    );
    return null;
  });
  // Throw after commit so rejected answers retain their attempt counter.
  if (failure) throw failure;
}
function publicUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.display_name,
    email: row.email,
    ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
  };
}
export function newSession(remember = true) {
  const token = randomBytes(32).toString("base64url");
  const seconds = remember ? 30 * 86400 : 86400;
  return {
    id: randomUUID(),
    token,
    tokenHash: digest(token),
    seconds,
    expires: new Date(Date.now() + seconds * 1000),
  };
}
export async function throttleAuth(identity: string, limit = 15, windowMinutes = 15) {
  const key = digest(`auth:${identity}`);
  const result = await database()
    .execute(sql`INSERT INTO cinevjet.auth_limits(key,attempts,window_start) VALUES(${key},1,now())
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN cinevjet.auth_limits.window_start < now() - (${windowMinutes}::int * interval '1 minute') THEN 1 ELSE LEAST(${limit + 1},cinevjet.auth_limits.attempts + 1) END,
    window_start = CASE WHEN cinevjet.auth_limits.window_start < now() - (${windowMinutes}::int * interval '1 minute') THEN now() ELSE cinevjet.auth_limits.window_start END RETURNING attempts,GREATEST(1,ceil(extract(epoch FROM window_start+(${windowMinutes}::int*interval '1 minute')-now()))) AS retry_after`);
  if (Number(result.rows[0]?.attempts) > limit)
    throw new ApiError(
      429,
      `Quá nhiều lần thử. Vui lòng thử lại sau ${windowMinutes < 60 ? `${windowMinutes} phút` : `${windowMinutes / 60} giờ`}.`,
      Number(result.rows[0]?.retry_after || windowMinutes * 60),
    );
}
export function registrationEmailIdentity(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  return domain === "gmail.com" || domain === "googlemail.com"
    ? `${local.split("+")[0].replaceAll(".", "")}@gmail.com`
    : `${local}@${domain}`;
}
export async function throttleRegistration(email: string, ip: string) {
  await throttleAuth(`registration:ip:hour:${ip}`, 5, 60);
  await throttleAuth(`registration:ip:day:${ip}`, 10, 1440);
  await throttleAuth(`registration:email:${registrationEmailIdentity(email)}`, 3, 60);
}
export async function register(input: unknown) {
  const data = registrationSchema.parse(input);
  const passwordHash = await hash(data.password, 12);
  const session = newSession(data.remember);
  const user = await database().transaction(async (tx) => {
    const identity = registrationEmailIdentity(data.email);
    if (identity.endsWith("@gmail.com")) {
      // Serialize Gmail aliases without changing existing user emails or financial data.
      const lockKey = digest(`registration-identity:${identity}`);
      await tx.execute(sql`INSERT INTO cinevjet.auth_limits(key,attempts,window_start) VALUES(${lockKey},0,now())
        ON CONFLICT(key) DO UPDATE SET attempts=cinevjet.auth_limits.attempts`);
      const existing = await tx.execute(sql`SELECT id FROM cinevjet.users
        WHERE lower(split_part(email,'@',2)) IN ('gmail.com','googlemail.com')
        AND replace(split_part(split_part(lower(email),'@',1),'+',1),'.','')=${identity.split("@")[0]}
        LIMIT 1`);
      if (existing.rows.length) throw new ApiError(409, "Email đã được sử dụng.");
    }
    const id = randomUUID();
    let referredBy: string | null = null;
    if (data.referral_code) {
      const referrer = (
        await tx.execute(
          sql`SELECT id FROM cinevjet.users WHERE referral_code=${data.referral_code} AND status='ACTIVE' LIMIT 1`,
        )
      ).rows[0];
      if (!referrer) throw new ApiError(400, "Mã giới thiệu không tồn tại.");
      referredBy = String(referrer.id);
    }
    const referralCode = randomReferralCode();
    const result =
      await tx.execute(sql`INSERT INTO cinevjet.users(id,email,password_hash,display_name,referral_code,referred_by) VALUES(${id},${data.email},${passwordHash},${data.display_name},${referralCode},${referredBy})
      ON CONFLICT(email) DO NOTHING RETURNING id,email,display_name,avatar_url`);
    if (!result.rows.length) throw new ApiError(409, "Email đã được sử dụng.");
    await tx.execute(sql`INSERT INTO cinevjet.coin_wallets(user_id) VALUES(${id})`);
    await tx.execute(sql`INSERT INTO cinevjet.wallets(user_id) VALUES(${id})`);
    await tx.execute(
      sql`INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES(${session.id},${id},${session.tokenHash},${session.expires})`,
    );
    return publicUser(result.rows[0] as UserRow);
  });
  return { user, session };
}
// Fixed valid bcrypt hash makes nonexistent-account checks take the same hash work as normal login.
const dummyHash = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxwJQGD98DmvvyGl.jKrMxmgV5m";
export async function login(input: unknown) {
  const data = credentialsSchema.parse(input);
  const result = await database().execute(
    sql`SELECT * FROM cinevjet.users WHERE email = ${data.email} LIMIT 1`,
  );
  const row = result.rows[0] as UserRow | undefined;
  const valid = await compare(data.password, row?.password_hash || dummyHash);
  if (!row || !valid || row.status !== "ACTIVE")
    throw new ApiError(401, "Email hoặc mật khẩu không đúng.");
  const session = newSession(data.remember);
  await database().transaction(async (tx) => {
    const latest = (
      await tx.execute(
        sql`SELECT email,password_hash,status FROM cinevjet.users WHERE id=${row.id} FOR SHARE`,
      )
    ).rows[0];
    if (
      latest?.password_hash !== row.password_hash ||
      latest.status !== "ACTIVE" ||
      latest.email !== row.email
    )
      throw new ApiError(401, "Email hoặc mật khẩu không đúng.");
    await tx.execute(
      sql`INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES(${session.id},${row.id},${session.tokenHash},${session.expires})`,
    );
  });
  return { user: publicUser(row), session };
}
export async function resolveSession(token: string | undefined): Promise<User | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await database()
    .execute(sql`SELECT u.id,u.email,u.display_name,u.avatar_url FROM cinevjet.sessions s JOIN cinevjet.users u ON u.id=s.user_id
    WHERE s.token_hash=${digest(token)} AND s.expires_at > now() AND u.status='ACTIVE' LIMIT 1`);
  return result.rows[0] ? publicUser(result.rows[0] as UserRow) : null;
}
export async function invalidateSession(token: string | undefined) {
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
    await database().execute(sql`DELETE FROM cinevjet.sessions WHERE token_hash=${digest(token)}`);
}
