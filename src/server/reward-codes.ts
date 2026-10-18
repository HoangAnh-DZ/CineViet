import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { digest } from "./auth-core";
import { lockCoinWallet } from "./rewards";
import { rewardCodeCreateSchema, rewardCodeRedeemSchema } from "./validation";

function normalize(value: string) {
  return value.trim().toUpperCase();
}
function generatedCode() {
  return `CVJ-${randomBytes(6).toString("hex").toUpperCase()}`;
}
function codeHash(code: string) {
  return digest(`reward-code:${normalize(code)}`);
}

export async function createRewardCode(actor: string, input: unknown) {
  await assertAdmin(actor);
  const data = rewardCodeCreateSchema.parse(input);
  const code = normalize(data.code || generatedCode());
  const id = randomUUID();
  await database().execute(sql`INSERT INTO cinevjet.reward_codes(id,code_hash,code_last4,reward_coins,max_redemptions,expires_at,created_by)
    VALUES(${id},${codeHash(code)},${code.slice(-4)},${data.reward_coins},${data.max_redemptions},${data.expires_at ? new Date(data.expires_at) : null},${actor})`);
  return { id, code, reward_coins: data.reward_coins, max_redemptions: data.max_redemptions, expires_at: data.expires_at || null };
}

export async function listRewardCodes(actor: string) {
  await assertAdmin(actor);
  const result = await database().execute(sql`SELECT id,code_last4,reward_coins,max_redemptions,redeemed_count,expires_at,created_at FROM cinevjet.reward_codes ORDER BY created_at DESC,id DESC LIMIT 100`);
  return result.rows.map((row) => ({ ...row, reward_coins: Number(row.reward_coins), max_redemptions: Number(row.max_redemptions), redeemed_count: Number(row.redeemed_count) }));
}

export async function redeemRewardCode(userId: string, input: unknown) {
  const { code } = rewardCodeRedeemSchema.parse(input);
  return database().transaction(async (tx) => {
    await lockCoinWallet(tx, userId);
    const row = (await tx.execute(sql`SELECT * FROM cinevjet.reward_codes WHERE code_hash=${codeHash(code)} FOR UPDATE`)).rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(400, "Mã đổi thưởng không hợp lệ.");
    if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) throw new ApiError(400, "Mã đổi thưởng đã hết hạn.");
    if (Number(row.redeemed_count) >= Number(row.max_redemptions)) throw new ApiError(400, "Mã đổi thưởng đã hết lượt.");
    const redemptionId = randomUUID();
    const inserted = await tx.execute(sql`INSERT INTO cinevjet.reward_code_redemptions(id,code_id,user_id,reward_coins) VALUES(${redemptionId},${row.id},${userId},${row.reward_coins}) ON CONFLICT(code_id,user_id) DO NOTHING RETURNING id`);
    if (!inserted.rows.length) throw new ApiError(409, "Bạn đã dùng mã này rồi.");
    await tx.execute(sql`UPDATE cinevjet.reward_codes SET redeemed_count=redeemed_count+1 WHERE id=${row.id}`);
    await tx.execute(sql`UPDATE cinevjet.coin_wallets SET balance=balance+${row.reward_coins}::bigint WHERE user_id=${userId}`);
    await tx.execute(sql`INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${userId},${row.reward_coins},'REWARD_CODE','REWARD_CODE',${redemptionId})`);
    const balance = (await tx.execute(sql`SELECT balance FROM cinevjet.coin_wallets WHERE user_id=${userId}`)).rows[0];
    return { reward_coins: Number(row.reward_coins), balance: Number(balance?.balance || 0) };
  });
}
