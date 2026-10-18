import "server-only";
import { ZodError } from "zod";
import { currentOriginConfig, resolveRequestOrigin } from "@/lib/domain-routing";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function requestOrigin(request: { headers: Pick<Headers, "get">; url?: string }) {
  const origin = resolveRequestOrigin(request, currentOriginConfig());
  if (!origin) throw new ApiError(403, "Tên miền chưa được cấu hình.");
  return origin;
}
export function checkOrigin(request: Request) {
  const origin = requestOrigin(request);
  if (request.headers.get("origin") !== origin) throw new ApiError(403, "Yêu cầu không hợp lệ.");
  return origin;
}
export async function readBody(request: Request, maxLength = 8192) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new ApiError(415, "Dữ liệu phải là JSON.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxLength))
    throw new ApiError(413, "Dữ liệu quá lớn.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON không hợp lệ.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxLength) throw new ApiError(413, "Dữ liệu quá lớn.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, "JSON không hợp lệ.");
  }
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, {
    status,
    headers: { ...headers, "Cache-Control": "private, no-store" },
  });
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return json(
      { error: error.message },
      error.status,
      error.status === 429
        ? { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfter || 60))) }
        : {},
    );
  if (error instanceof ZodError)
    return json({ error: error.issues[0]?.message || "Dữ liệu không hợp lệ." }, 400);
  console.error("CineVjet request failed.");
  return json({ error: "Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại." }, 503);
}
