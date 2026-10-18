import "server-only";
import { createHmac } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { ApiError } from "./http";

function key() {
  const value = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new ApiError(503, "Lưu ngân hàng tạm thời chưa sẵn sàng. Vui lòng thử lại sau.");
  const result = Buffer.from(value, "base64url");
  if (result.length !== 32) throw new ApiError(503, "Lưu ngân hàng tạm thời chưa sẵn sàng.");
  return result;
}
const secretInput = z.object({
  account_number: z.string().regex(/^\d{4,40}$/),
  account_holder_name: z.string().min(2).max(120),
});
export type BankDetails = z.infer<typeof secretInput>;
// Standard authenticated JWE. Binding prevents ciphertext from being moved
// between users, saved accounts, or withdrawal snapshots. Never log plaintext.
export async function sealBankDetails(details: BankDetails, binding: string) {
  return new EncryptJWT({ ...secretInput.parse(details), binding })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: "bank-v1" })
    .encrypt(key());
}
export async function openBankDetails(ciphertext: string, binding: string): Promise<BankDetails> {
  try {
    const { payload } = await jwtDecrypt(ciphertext, key(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (payload.binding !== binding) throw new Error("Invalid bank binding");
    return secretInput.parse(payload);
  } catch {
    throw new ApiError(503, "Chưa đọc được thông tin ngân hàng an toàn. Vui lòng thử lại sau.");
  }
}
export function bankFingerprint(userId: string, bankCode: string, number: string) {
  return createHmac("sha256", key())
    .update(`bank-dedup:v1:${userId}:${bankCode}:${number}`)
    .digest("hex");
}

const withdrawalPrefix = "bank-snapshot:v1:";
// Direct-entry withdrawals have no saved-account FK. Migration 0019 binds that
// FK to bank_snapshot_ciphertext, so their authenticated envelope lives in the
// existing destination text field. This requires no DDL or historical rewrite.
export async function sealedWithdrawalDestination(
  userId: string,
  id: string,
  details: BankDetails,
) {
  return withdrawalPrefix + (await sealBankDetails(details, `withdrawal:${userId}:${id}`));
}
export async function withdrawalBankDetails(row: Record<string, unknown>): Promise<BankDetails> {
  const destination = String(row.destination || "");
  const cipher =
    row.bank_snapshot_ciphertext ||
    (destination.startsWith(withdrawalPrefix) ? destination.slice(withdrawalPrefix.length) : null);
  if (cipher) return openBankDetails(String(cipher), `withdrawal:${row.user_id}:${row.id}`);
  // Existing plaintext requests remain readable; never copy them into new rows.
  const number = String(row.bank_account_number || "");
  if (!/^\d{4,40}$/.test(number))
    throw new ApiError(503, "Chưa đọc được thông tin ngân hàng an toàn.");
  return { account_number: number, account_holder_name: String(row.bank_account_name || "") };
}
