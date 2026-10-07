import "server-only";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { hash, compare } from "bcryptjs";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { credentialsSchema, registrationSchema } from "./validation";
import type { User } from "@/domain/models";
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
function digest(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET cần tối thiểu 32 ký tự.");
  return createHmac("sha256", secret).update(value).digest("hex");
}
function publicUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.display_name,
    email: row.email,
    ...(row.avatar_url ? { avatar: row.avatar_url } : {}),
  };
}
function newSession(remember = true) {
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
export async function throttleAuth(identity: string, limit = 15) {
  const key = digest(`auth:${identity}`);
  const result = await database()
    .execute(sql`INSERT INTO cinevjet.auth_limits(key,attempts,window_start) VALUES(${key},1,now())
    ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN cinevjet.auth_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE cinevjet.auth_limits.attempts + 1 END,
    window_start = CASE WHEN cinevjet.auth_limits.window_start < now() - interval '15 minutes' THEN now() ELSE cinevjet.auth_limits.window_start END RETURNING attempts`);
  if (Number(result.rows[0]?.attempts) > limit)
    throw new ApiError(429, "Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.");
}
export async function register(input: unknown) {
  const data = registrationSchema.parse(input);
  const passwordHash = await hash(data.password, 12);
  const session = newSession(data.remember);
  const user = await database().transaction(async (tx) => {
    const id = randomUUID();
    const result =
      await tx.execute(sql`INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES(${id},${data.email},${passwordHash},${data.display_name})
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
  await database().execute(
    sql`INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES(${session.id},${row.id},${session.tokenHash},${session.expires})`,
  );
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
