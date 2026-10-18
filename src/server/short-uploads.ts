import "server-only";
import { head } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { validUpload } from "@/domain/short-validation";
export function validMediaSignature(mime: string, bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (mime === "video/mp4") return b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp";
  if (mime === "video/webm") return b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png")
    return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  return false;
}
export async function verifyShortUpload(userId: string, url: string, kind: "video" | "thumbnail") {
  await assertAdmin(userId);
  const store =
    process.env.BLOB_READ_WRITE_TOKEN?.match(/^vercel_blob_rw_([^_]+)_/)?.[1] ||
    process.env.BLOB_STORE_ID?.replace(/^store_/, "");
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ApiError(400, "URL upload không hợp lệ.");
  }
  if (
    !store ||
    target.protocol !== "https:" ||
    target.hostname !== `${store.toLowerCase()}.public.blob.vercel-storage.com` ||
    target.username ||
    target.password ||
    !target.pathname.startsWith(`/shorts/${userId}/${kind}/`)
  )
    throw new ApiError(400, "File không thuộc storage upload của bạn.");
  const blob = await head(url);
  if (!validUpload(kind, blob.pathname, blob.contentType, blob.size))
    throw new ApiError(400, "File không đúng định dạng hoặc kích thước.");
  const response = await fetch(url, {
    headers: { Range: "bytes=0-63" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const reader = response.body?.getReader();
  if (!response.ok || !reader) throw new ApiError(400, "Chưa đọc được file upload.");
  let bytes = new Uint8Array(0);
  try {
    while (bytes.length < 64) {
      const part = await reader.read();
      if (part.done) break;
      bytes = Buffer.concat([bytes, part.value.subarray(0, 64 - bytes.length)]);
    }
  } finally {
    await reader.cancel();
  }
  if (!validMediaSignature(blob.contentType, bytes))
    throw new ApiError(400, "Nội dung file không khớp định dạng MP4/WebM hoặc ảnh hỗ trợ.");
  await database().execute(
    sql`INSERT INTO cinevjet.short_uploads(url,user_id,kind,content_type,size_bytes) VALUES(${url},${userId},${kind},${blob.contentType},${blob.size}) ON CONFLICT(url) DO NOTHING`,
  );
  return { url };
}
