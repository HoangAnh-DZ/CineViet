import test from "node:test";
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createRedemption, redemptionHistory } from "../src/server/redemption";
import { userMoneyRequests } from "../src/server/manual-money";
// Disposable local SQL database; no expired branch or production credentials required.
const pool = new PGlite();
for (const name of (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort())
  await pool.exec(await readFile(`database/migrations/${name}`, "utf8"));
await pool.exec(await readFile("database/seed.sql", "utf8"));
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  pool,
) as unknown as NodePgDatabase;
test("History filters each asset before limiting rows", async () => {
  const u = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [u, `${u}@history-qa.example.test`, "unused", "History QA"],
  );
  await pool.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [u]);
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,100000)", [u]);
  const r = await createRedemption(u, {
    coins: 35000,
    bank_name: "TPBank",
    account_name: "QA ONLY",
    account_number: "1234567890",
    idempotency_key: randomUUID(),
  });
  await pool.query(
    "UPDATE cinevjet.withdrawals SET created_at=now()-interval '1 hour' WHERE id=$1",
    [r.id],
  );
  // Rejected historical cash fixtures carry no financial debit/reservation.
  for (let i = 0; i < 51; i++)
    await pool.query(
      "INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,status) VALUES($1,$2,50000,3000,'QA ONLY',$3,'REJECTED')",
      [randomUUID(), u, randomUUID()],
    );
  const coins = await redemptionHistory(u),
    cash = await userMoneyRequests(u, "VND");
  assert.equal(coins.length, 1);
  assert.equal(coins[0].id, r.id);
  assert.equal(cash.length, 50);
  assert.ok(cash.every((r) => r.source_asset === "VND"));
  assert.deepEqual(
    (
      await pool.query(
        "SELECT balance::int,reserved::int FROM cinevjet.coin_wallets WHERE user_id=$1",
        [u],
      )
    ).rows[0],
    { balance: 100000, reserved: 35000 },
  );
});
test.after(async () => pool.close());
