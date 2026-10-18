import { cookies } from "next/headers";
import { requireUser, sessionCookie, cookieOptions } from "@/server/auth";
import { checkOrigin, failure, json, readBody, ApiError } from "@/server/http";
import {
  changePassword,
  requestEmailChange,
  confirmEmailChange,
  emailVerificationAvailable,
} from "@/server/account-security";
export async function GET(_request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    await requireUser();
    if ((await params).action !== "email") throw new ApiError(404, "Không tìm thấy.");
    return json({ available: emailVerificationAvailable() });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const origin = checkOrigin(request),
      u = await requireUser(),
      jar = await cookies(),
      token = jar.get(sessionCookie)?.value || "",
      v = await readBody(request),
      action = (await params).action;
    if (action === "email") return json(await requestEmailChange(u.id, token, v, origin));
    if (action !== "password" && action !== "confirm-email")
      throw new ApiError(404, "Không tìm thấy.");
    const result =
      action === "password"
        ? await changePassword(u.id, token, v)
        : await confirmEmailChange(u.id, token, v);
    jar.set(sessionCookie, result.session.token, {
      ...cookieOptions,
      maxAge: result.session.seconds,
    });
    return json({ user: result.user });
  } catch (e) {
    return failure(e);
  }
}
