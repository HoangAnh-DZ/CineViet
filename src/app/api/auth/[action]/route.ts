import { cookies } from "next/headers";
import {
  cookieOptions,
  currentUser,
  invalidateSession,
  login,
  register,
  createRegistrationChallenge,
  verifyRegistrationChallenge,
  sessionCookie,
  throttleAuth,
  throttleRegistration,
} from "@/server/auth";
import { checkOrigin, failure, json, readBody, ApiError } from "@/server/http";
import {
  credentialsSchema,
  registrationRequestSchema,
  registrationSchema,
} from "@/server/validation";
import { checkRegistrationBrowser } from "@/server/registration-protection";
import { clientAddress } from "@/server/request-limit";
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
    const ip = clientAddress(request);
    if (action === "register-check" || action === "register-code") {
      await throttleAuth(`registration-browser:${ip}`, 60, 60);
      await checkRegistrationBrowser();
      if (action === "register-code") {
        await throttleAuth(`registration-code:${ip}`, 12, 60);
        return json(await createRegistrationChallenge());
      }
      return json({ ready: true });
    }
    const jar = await cookies();
    if (action === "logout") {
      await invalidateSession(jar.get(sessionCookie)?.value);
      jar.set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
      return json({ user: null });
    }
    if (!["login", "register"].includes(action)) throw new ApiError(404, "Không tìm thấy.");
    if (action === "register") await checkRegistrationBrowser();
    const body = await readBody(request),
      data = action === "register" ? registrationSchema.parse(body) : credentialsSchema.parse(body);
    if (action === "register") {
      await throttleRegistration(data.email, ip);
      const registration = registrationRequestSchema.parse(body);
      await verifyRegistrationChallenge({
        id: registration.verification_challenge,
        code: registration.verification_code,
      });
    } else {
      // Stop blocked addresses before allocating counters for arbitrary emails.
      await throttleAuth(`ip:${ip}`, 60);
      await throttleAuth(`email:${data.email}`);
    }
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
