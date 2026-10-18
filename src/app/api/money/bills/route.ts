import { requireUser } from "@/server/auth";
import { checkOrigin, json, failure, ApiError } from "@/server/http";
import { throttleAuth } from "@/server/auth-core";
import { saveBillUpload } from "@/server/bill-storage";
import { BILL_MAX_BYTES } from "@/domain/money";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    await throttleAuth("bill-upload:" + user.id, 12);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new ApiError(415, "Vui lòng gửi file ảnh.");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "Thiếu file ảnh.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > BILL_MAX_BYTES + 65536) throw new ApiError(413, "Bill tối đa 3 MB.");
        chunks.push(p.value);
      }
    } finally {
      await reader.cancel();
    }
    const body = await new Response(Uint8Array.from(Buffer.concat(chunks)), {
        headers: { "Content-Type": request.headers.get("content-type")! },
      }).formData(),
      file = body.get("bill");
    if (!(file instanceof File)) throw new ApiError(400, "Vui lòng chọn ảnh bill.");
    return json(await saveBillUpload(user.id, file), 201);
  } catch (e) {
    return failure(e);
  }
}
