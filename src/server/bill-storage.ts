import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { BILL_MAX_BYTES, validBillFile } from "@/domain/money";
export async function prepareBillImage(file: File) {
  if (!validBillFile(file.name, file.type, file.size))
    throw new ApiError(400, "Bill phải là JPG, PNG hoặc WebP, tối đa 3 MB.");
  try {
    const source = Buffer.from(await file.arrayBuffer());
    const image = sharp(source, { limitInputPixels: 20000000, failOn: "warning", animated: false });
    const formats: Record<string, string> = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const meta = await image.metadata(),
      format = formats[file.type];
    if (meta.format !== format || !meta.width || !meta.height || (meta.pages || 1) > 1)
      throw new Error("Invalid image");
    const { data, info } = await image
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > BILL_MAX_BYTES) throw new Error("Too large");
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ApiError(
      400,
      "Không đọc được ảnh bill. Vui lòng chọn ảnh JPG, PNG hoặc WebP hợp lệ.",
    );
  }
}
export async function saveBillUpload(userId: string, file: File) {
  const image = await prepareBillImage(file);
  const id = randomUUID();
  // Existing public Blob store; the filename is server-generated and never user controlled.
  const blob = await put(`deposit-bills/${userId}/${id}.webp`, image.data, {
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: true,
    allowOverwrite: false,
  });
  await database().execute(
    sql`INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES(${id},${userId},${blob.url},'image/webp',${image.data.length},${image.width},${image.height})`,
  );
  return { id, url: blob.url };
}
