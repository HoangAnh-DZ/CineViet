// Temporary local preview backed only by the empty QA database on the expiring branch.
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgConfig } from "./pg-config.mjs";
import { createRewardCode, redeemRewardCode } from "../src/server/reward-codes";
import { createRedemption } from "../src/server/redemption";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL!);
url.hostname = "ep-dawn-boat-b3eq3mnu-pooler.c-4.ap-southeast-1.aws.neon.tech";
url.pathname = "/financial_sync_qa_20261015";
process.env.DATABASE_URL = url.toString();
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
for (const key of Object.keys(process.env))
  if (/^(PAYOS_|VERCEL|TURBO)/.test(key)) delete process.env[key];
const pool = new Pool(pgConfig());
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(pool);
const admin = randomUUID(),
  member = randomUUID();
const password = "CineVjetLocalQA!2026",
  passwordHash = await hash(password, 10);
for (const [id, name] of [
  [admin, "Financial QA Admin"],
  [member, "Financial QA User"],
]) {
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [id, `${id}@example.invalid`, passwordHash, name],
  );
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  await pool.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
}
await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [admin]);
const code = await createRewardCode(admin, { reward_coins: 100000 });
await redeemRewardCode(member, { code: code.code });
const orders = [];
for (let i = 0; i < 2; i++)
  orders.push(
    await createRedemption(member, {
      coins: 35000,
      bank_name: "QA Bank",
      account_number: "123456789",
      account_name: "LOCAL QA ONLY",
      idempotency_key: randomUUID(),
    }),
  );
await writeFile(
  ".vercel/financial-qa.json",
  JSON.stringify({
    admin,
    member,
    adminEmail: `${admin}@example.invalid`,
    memberEmail: `${member}@example.invalid`,
    orders: orders.map((r) => r.id),
  }),
);
await pool.end();
const children = [3012].map((port) =>
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env: { ...process.env, NEXT_PUBLIC_APP_URL: `http://localhost:${port}` }, stdio: "inherit" },
  ),
);
console.log("Financial QA preview: localhost:3012; isolated database only.");
process.on("SIGINT", () => {
  for (const child of children) child.kill("SIGINT");
  process.exit(0);
});
