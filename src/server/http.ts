import "server-only";
import { ZodError } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (!origin || origin !== allowed) throw new ApiError(403, "Yêu cầu không hợp lệ.");
}
export async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "Dữ liệu phải là JSON.");
  const raw = await request.text();
  if (raw.length > 8192) throw new ApiError(413, "Dữ liệu quá lớn.");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, "JSON không hợp lệ.");
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json({ error: error.issues[0]?.message || "Dữ liệu không hợp lệ." }, 400);
  console.error("CineVjet request failed.");
  return json({ error: "Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại." }, 503);
}
