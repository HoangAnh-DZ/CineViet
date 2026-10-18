import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { moneyConfig } from "./money-config";
import { moneyDto, userMoneyRequests } from "./manual-money";
import { COIN_VALUE_VND, coinsToVnd, coinBalances } from "@/domain/coins";
import { withdrawalQuote } from "@/domain/rules";
import { validWithdrawalSelection, withdrawalFee } from "@/domain/product-policy";
import { redemptionInput } from "@/domain/money";
import { savedRedemptionInput, maskBankNumber } from "@/domain/bank-accounts";
import { savedBankAccountDetails } from "./bank-accounts";
import { sealBankDetails } from "./bank-secrets";
export async function redemptionSnapshot(userId: string) {
  const row = (
    await database().execute(
      sql`SELECT balance,reserved FROM cinevjet.coin_wallets WHERE user_id=${userId}`,
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "Ví xu không tồn tại.");
  const config = await moneyConfig();
  if (!config.withdrawal_enabled) throw new ApiError(503, "Đổi thưởng đang tạm bảo trì.");
  return {
    ...coinBalances(row.balance, row.reserved),
    coin_value_vnd: COIN_VALUE_VND,
    min_vnd: config.min_withdrawal,
    max_vnd: config.max_amount,
    fee_bps: config.withdrawal_fee_bps,
  };
}
export async function createRedemption(userId: string, input: unknown) {
  const saved = typeof input === "object" && input !== null && "bank_account_id" in input;
  const d = saved ? savedRedemptionInput.parse(input) : redemptionInput.parse(input),
    config = await moneyConfig();
  if (!config.withdrawal_enabled) throw new ApiError(503, "Đổi thưởng đang tạm bảo trì.");
  return database().transaction(async (tx) => {
    // Same lock order as saved-bank mutations. A concurrent edit cannot silently
    // change a destination after the user confirms it.
    if ("bank_account_id" in d) {
      const owner = (
        await tx.execute(
          sql`SELECT id FROM cinevjet.users WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`,
        )
      ).rows[0];
      if (!owner) throw new ApiError(403, "Tài khoản không thể đổi thưởng.");
    }
    const wallet = (
      await tx.execute(
        sql`SELECT c.balance,c.reserved FROM cinevjet.coin_wallets c JOIN cinevjet.users u ON u.id=c.user_id WHERE c.user_id=${userId} AND u.status='ACTIVE' FOR UPDATE OF c`,
      )
    ).rows[0];
    if (!wallet) throw new ApiError(403, "Tài khoản không thể đổi thưởng.");
    const old = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.withdrawals WHERE idempotency_key=${d.idempotency_key}`,
      )
    ).rows[0];
    if (old) {
      if (
        old.user_id !== userId ||
        old.source_asset !== "COIN" ||
        Number(old.coins_amount) !== d.coins ||
        ("bank_account_id" in d
          ? old.bank_account_id !== d.bank_account_id
          : old.bank_account_id ||
            old.bank_name !== d.bank_name ||
            old.bank_account_number !== d.account_number ||
            old.bank_account_name !== d.account_name) ||
        old.user_note !== d.note
      )
        throw new ApiError(409, "Mã yêu cầu đã được sử dụng.");
      return moneyDto(old, "WITHDRAWAL");
    }
    const recipient =
      "bank_account_id" in d
        ? await savedBankAccountDetails(tx, userId, d.bank_account_id)
        : {
            bank_name: d.bank_name,
            account_number: d.account_number,
            account_holder_name: d.account_name,
          };
    const amount = coinsToVnd(d.coins);
    let quote;
    try {
      if (!validWithdrawalSelection(amount) || amount < config.min_withdrawal)
        throw new Error("Invalid redemption amount");
      quote = withdrawalQuote(
        amount,
        Math.min(config.max_amount, 100000000),
        withdrawalFee(amount, config.withdrawal_fee_bps),
      );
    } catch {
      throw new ApiError(400, "Giá trị đổi ngoài hạn mức hiện hành theo tỷ lệ quy đổi.");
    }
    if (d.coins > coinBalances(wallet.balance, wallet.reserved).available)
      throw new ApiError(400, "Không đủ xu khả dụng để đổi thưởng.");
    const pending = (
      await tx.execute(
        sql`SELECT count(*)::int n FROM cinevjet.withdrawals WHERE user_id=${userId} AND status IN ('PENDING','PROCESSING') AND source_asset='COIN'`,
      )
    ).rows[0];
    if (Number(pending.n) >= 5) throw new ApiError(429, "Bạn đã có 5 yêu cầu đổi thưởng đang chờ.");
    await tx.execute(
      sql`UPDATE cinevjet.coin_wallets SET reserved=reserved+${d.coins} WHERE user_id=${userId}`,
    );
    const id = randomUUID();
    const r =
      "bank_account_id" in d
        ? await tx.execute(
            sql`INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,bank_name,bank_account_number,user_note,source_asset,coins_amount,coin_value_vnd,updated_at,bank_account_id,bank_snapshot_ciphertext) VALUES(${id},${userId},${quote.amount},${quote.fee},${recipient.bank_name + " / " + maskBankNumber(recipient.account_number)},${d.idempotency_key},${recipient.bank_name},${maskBankNumber(recipient.account_number)},${d.note},'COIN',${d.coins},${COIN_VALUE_VND},now(),${d.bank_account_id},${await sealBankDetails(recipient, `withdrawal:${userId}:${id}`)}) RETURNING *`,
          )
        : await tx.execute(
            sql`INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,bank_name,bank_account_number,bank_account_name,user_note,source_asset,coins_amount,coin_value_vnd,updated_at) VALUES(${id},${userId},${quote.amount},${quote.fee},${recipient.bank_name + " / " + recipient.account_number + " / " + recipient.account_holder_name},${d.idempotency_key},${recipient.bank_name},${recipient.account_number},${recipient.account_holder_name},${d.note},'COIN',${d.coins},${COIN_VALUE_VND},now()) RETURNING *`,
          );
    return moneyDto(r.rows[0], "WITHDRAWAL");
  });
}
export async function redemptionHistory(userId: string) {
  return userMoneyRequests(userId, "COIN");
}
