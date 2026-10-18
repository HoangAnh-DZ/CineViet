import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError } from "./http";
import { resolveSession, sessionCookie, throttleAuth } from "./auth-core";
export * from "./auth-core";
export async function currentUser() {
  return resolveSession((await cookies()).get(sessionCookie)?.value);
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "Vui lòng đăng nhập.");
  await throttleAuth(`api:${user.id}`, 360, 1);
  return user;
}
export async function protectPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
