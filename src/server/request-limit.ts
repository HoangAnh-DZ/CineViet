import "server-only";
import { isIP } from "node:net";
import { throttleAuth } from "./auth-core";

export function clientAddress(request: Request) {
  // Vercel overwrites this platform header. Never trust X-Forwarded-For or an
  // arbitrary header on a non-Vercel host, including local regression servers.
  if (process.env.VERCEL !== "1") return "local";
  const value = request.headers.get("x-vercel-forwarded-for")?.trim() || "";
  return isIP(value) ? value : "unknown";
}
export async function throttlePublic(request: Request, scope: string, limit = 180) {
  await throttleAuth(`public:${scope}:${clientAddress(request)}`, limit, 1);
}
