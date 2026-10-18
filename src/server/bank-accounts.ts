import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { bankAccountInput, maskBankNumber, type SavedBankAccount } from "@/domain/bank-accounts";
import { database } from "./db";
import { banks } from "./banks";
import { ApiError } from "./http";
import { bankFingerprint, openBankDetails, sealBankDetails } from "./bank-secrets";
type Executor = Pick<ReturnType<typeof database>, "execute">;
const binding = (user: string, id: string) => `saved-bank:${user}:${id}`;

async function lockOwner(tx: Executor, userId: string) {
  const r = await tx.execute(
    sql`SELECT id FROM cinevjet.users WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`,
  );
  if (!r.rows.length) throw new ApiError(403, "Tài khoản không thể quản lý ngân hàng.");
}
async function dto(r: Record<string, unknown>): Promise<SavedBankAccount> {
  const details = await openBankDetails(
    String(r.details_ciphertext),
    binding(String(r.user_id), String(r.id)),
  );
  return {
    id: String(r.id),
    bank_code: String(r.bank_code),
    bank_name: String(r.bank_name),
    bank_label: String(r.bank_label),
    account_number_masked: maskBankNumber(String(r.account_last4)),
    account_holder_name: details.account_holder_name,
    nickname: String(r.nickname),
    is_default: Boolean(r.is_default),
  };
}
export async function savedBankAccounts(userId: string) {
  const r = await database().execute(
    sql`SELECT * FROM cinevjet.user_bank_accounts WHERE user_id=${userId} AND deleted_at IS NULL ORDER BY is_default DESC,created_at,id LIMIT 20`,
  );
  return Promise.all(r.rows.map(dto));
}
export async function savedBankAccountDetails(tx: Executor, userId: string, id: string) {
  const r = (
    await tx.execute(
      sql`SELECT * FROM cinevjet.user_bank_accounts WHERE id=${id} AND user_id=${userId} AND deleted_at IS NULL FOR SHARE`,
    )
  ).rows[0];
  if (!r) throw new ApiError(404, "Tài khoản ngân hàng không còn khả dụng. Hãy chọn lại.");
  return {
    ...(await openBankDetails(String(r.details_ciphertext), binding(userId, id))),
    bank_name: String(r.bank_name),
    bank_code: String(r.bank_code),
  };
}
export async function saveBankAccount(userId: string, input: unknown, replacingId?: string) {
  const d = bankAccountInput.parse(input);
  const bank = (await banks()).find((b) => b.code === d.bank_code);
  if (!bank) throw new ApiError(400, "Ngân hàng không hợp lệ. Hãy chọn lại trong danh sách.");
  const id = randomUUID();
  const fingerprint = bankFingerprint(userId, bank.code, d.account_number);
  const encrypted = await sealBankDetails(d, binding(userId, id));
  return database().transaction(async (tx) => {
    await lockOwner(tx, userId);
    let previous: Record<string, unknown> | undefined;
    if (replacingId) {
      previous = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.user_bank_accounts WHERE id=${replacingId} AND user_id=${userId} AND deleted_at IS NULL`,
        )
      ).rows[0];
      if (!previous)
        throw new ApiError(404, "Tài khoản ngân hàng không còn khả dụng. Hãy tải lại danh sách.");
    }
    const duplicate = (
      await tx.execute(
        sql`SELECT id FROM cinevjet.user_bank_accounts WHERE user_id=${userId} AND fingerprint=${fingerprint} AND deleted_at IS NULL AND id<>${replacingId || ""}`,
      )
    ).rows[0];
    if (duplicate) throw new ApiError(409, "Tài khoản ngân hàng này đã được liên kết.");
    const count = Number(
      (
        await tx.execute(
          sql`SELECT count(*)::int n FROM cinevjet.user_bank_accounts WHERE user_id=${userId} AND deleted_at IS NULL`,
        )
      ).rows[0].n,
    );
    if (!previous && count >= 10)
      throw new ApiError(400, "Bạn có thể lưu tối đa 10 tài khoản ngân hàng.");
    if (previous)
      await tx.execute(
        sql`UPDATE cinevjet.user_bank_accounts SET deleted_at=now(),updated_at=now(),is_default=false WHERE id=${replacingId} AND user_id=${userId}`,
      );
    const isDefault = count === 0 || Boolean(previous?.is_default);
    const r = await tx.execute(
      sql`INSERT INTO cinevjet.user_bank_accounts(id,user_id,bank_code,bank_name,bank_label,details_ciphertext,account_last4,fingerprint,nickname,is_default) VALUES(${id},${userId},${bank.code},${bank.name},${bank.label},${encrypted},${d.account_number.slice(-4)},${fingerprint},${d.nickname},${isDefault}) RETURNING *`,
    );
    return dto(r.rows[0]);
  });
}
export async function defaultBankAccount(userId: string, id: string) {
  return database().transaction(async (tx) => {
    await lockOwner(tx, userId);
    const target = (
      await tx.execute(
        sql`SELECT id FROM cinevjet.user_bank_accounts WHERE id=${id} AND user_id=${userId} AND deleted_at IS NULL`,
      )
    ).rows[0];
    if (!target) throw new ApiError(404, "Tài khoản ngân hàng không còn khả dụng.");
    await tx.execute(
      sql`UPDATE cinevjet.user_bank_accounts SET is_default=false,updated_at=now() WHERE user_id=${userId} AND is_default AND deleted_at IS NULL`,
    );
    const r = await tx.execute(
      sql`UPDATE cinevjet.user_bank_accounts SET is_default=true,updated_at=now() WHERE id=${id} AND user_id=${userId} RETURNING *`,
    );
    return dto(r.rows[0]);
  });
}
export async function deleteBankAccount(userId: string, id: string) {
  return database().transaction(async (tx) => {
    await lockOwner(tx, userId);
    const r = (
      await tx.execute(
        sql`UPDATE cinevjet.user_bank_accounts SET deleted_at=now(),updated_at=now(),is_default=false WHERE id=${id} AND user_id=${userId} AND deleted_at IS NULL RETURNING id`,
      )
    ).rows[0];
    if (!r) throw new ApiError(404, "Tài khoản ngân hàng không còn khả dụng.");
    // Deterministic fallback: oldest active account, with id as tie-breaker.
    await tx.execute(
      sql`UPDATE cinevjet.user_bank_accounts SET is_default=true,updated_at=now() WHERE id=(SELECT id FROM cinevjet.user_bank_accounts WHERE user_id=${userId} AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM cinevjet.user_bank_accounts WHERE user_id=${userId} AND is_default AND deleted_at IS NULL) ORDER BY created_at,id LIMIT 1)`,
    );
    return { deleted: true };
  });
}
