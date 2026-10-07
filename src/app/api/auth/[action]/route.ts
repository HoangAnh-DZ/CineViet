import { cookies } from "next/headers";
import {
  cookieOptions,
  currentUser,
  invalidateSession,
  login,
  register,
  sessionCookie,
  throttleAuth,
} from "@/server/auth";
import { checkOrigin, failure, json, readBody, ApiError } from "@/server/http";
import { credentialsSchema } from "@/server/validation";
export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    if ((await context.params).action !== "session") throw new ApiError(404, "Không tìm thấy.");
    return json({ user: await currentUser() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    checkOrigin(request);
    const action = (await context.params).action;
    const jar = await cookies();
    if (action === "logout") {
      await invalidateSession(jar.get(sessionCookie)?.value);
      jar.set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
      return json({ user: null });
    }
    if (!["login", "register"].includes(action)) throw new ApiError(404, "Không tìm thấy.");
    const body = await readBody(request),
      data = credentialsSchema.parse(body);
    const ip = process.env.VERCEL
      ? request.headers.get("x-vercel-forwarded-for") || "unknown"
      : "local";
    await Promise.all([throttleAuth(`email:${data.email}`), throttleAuth(`ip:${ip}`, 60)]);
    const result = action === "register" ? await register(body) : await login(body);
    await invalidateSession(jar.get(sessionCookie)?.value);
    jar.set(sessionCookie, result.session.token, {
      ...cookieOptions,
      maxAge: result.session.seconds,
    });
    return json({ user: result.user }, action === "register" ? 201 : 200);
  } catch (e) {
    return failure(e);
  }
}
