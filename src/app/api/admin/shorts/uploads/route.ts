import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireAdmin } from "@/server/admin";
import { checkOrigin, readBody, json, failure, ApiError } from "@/server/http";
import { MAX_UPLOAD_BYTES, validUpload } from "@/domain/short-validation";
export async function POST(request: Request) {
  try {
    const body = (await readBody(request)) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, payload) => {
        const user = await requireAdmin();
        checkOrigin(request);
        if (!process.env.BLOB_READ_WRITE_TOKEN)
          throw new ApiError(503, "Storage upload chưa được cấu hình.");
        let file;
        try {
          file = JSON.parse(payload || "");
        } catch {
          throw new ApiError(400, "Thông tin file không hợp lệ.");
        }
        if (
          !["video", "thumbnail"].includes(file.kind) ||
          typeof file.name !== "string" ||
          !validUpload(file.kind, file.name, file.type, file.size) ||
          !new RegExp(
            `^shorts/${user.id}/${file.kind}/[a-f0-9-]{36}\\.(mp4|webm|jpg|jpeg|png|webp)$`,
          ).test(pathname)
        )
          throw new ApiError(400, "Định dạng hoặc kích thước file không hỗ trợ.");
        if (pathname.split(".").at(-1) !== file.name.toLowerCase().split(".").at(-1))
          throw new ApiError(400, "Đuôi file không khớp.");
        return {
          allowedContentTypes: [file.type],
          maximumSizeInBytes: Math.min(file.size, MAX_UPLOAD_BYTES),
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return json(result);
  } catch (e) {
    return failure(e);
  }
}
