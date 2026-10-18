// Temporary QA preview; forces the isolated branch before opening any database connection.
import { Pool } from "pg";
import { pgConfig } from "./pg-config.mjs";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
url.hostname = "ep-patient-surf-b3s99cl5-pooler.c-4.ap-southeast-1.aws.neon.tech";
process.env.DATABASE_URL = url.toString();
const pool = new Pool(pgConfig()),
  password = randomBytes(18).toString("base64url"),
  digest = await hash(password, 10),
  adminId = randomUUID(),
  userId = randomUUID();
for (const [id, name, coins] of [
  [adminId, "Rewards QA admin", 0],
  [userId, "Rewards QA user", 300000],
]) {
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [id, `${id}@rewards-ui.example.test`, digest, name],
  );
  await pool.query("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,0)", [id]);
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,$2)", [id, coins]);
}
await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [adminId]);
await pool.end();
await writeFile(
  "test-results/rewards-preview-credentials.json",
  JSON.stringify({
    password,
    adminId,
    userId,
    adminEmail: `${adminId}@rewards-ui.example.test`,
    userEmail: `${userId}@rewards-ui.example.test`,
  }),
);
const env = {
  ...process.env,
  NEXT_PUBLIC_APP_URL: "http://localhost:3010",
  AUTH_SECRET: randomBytes(48).toString("base64url"),
};
for (const key of Object.keys(env))
  if (key.startsWith("VERCEL") || key.startsWith("TURBO") || key === "NX_DAEMON") delete env[key];
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3010",
  ],
  { env, stdio: "inherit" },
);
console.log("Rewards/VIP QA preview: dedicated Neon branch; no production database connection.");
child.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => child.kill("SIGINT"));
