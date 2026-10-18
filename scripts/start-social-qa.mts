// Local UI verification only; always uses the empty database on the expiring QA branch.
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { pgConfig } from "./pg-config.mjs";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL!);
url.hostname = "ep-dawn-boat-b3eq3mnu-pooler.c-4.ap-southeast-1.aws.neon.tech";
url.pathname = "/social_shorts_qa_20261015";
process.env.DATABASE_URL = url.toString();
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
for (const key of Object.keys(process.env))
  if (/^(PAYOS_|VERCEL|TURBO)/.test(key)) delete process.env[key];
const pool = new Pool(pgConfig());
// Seeding follows migrations in this empty database, so supply its basic nonfinancial plan config.
await pool.query(
  "UPDATE cinevjet.vip_plans SET reward_tier='FREE',checkin_rewards=ARRAY[200,300,500,700,1000,1300,2000] WHERE id='FREE'",
);
const fixture: Record<string, string> = { password: "CineVjetLocalQA!2026" };
const passwordHash = await hash(fixture.password, 10);
for (const role of ["admin", "member"]) {
  const id = randomUUID(),
    email = `${id}@example.invalid`;
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [id, email, passwordHash, `Social QA ${role}`],
  );
  if (role === "admin")
    await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  fixture[role] = id;
  fixture[`${role}Email`] = email;
}
await writeFile(".vercel/social-qa.json", JSON.stringify(fixture));
await pool.end();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3014",
  ],
  { env: { ...process.env, NEXT_PUBLIC_APP_URL: "http://localhost:3014" }, stdio: "inherit" },
);
console.log("Social Shorts QA: localhost:3014, isolated database only.");
process.on("SIGINT", () => {
  child.kill("SIGINT");
  process.exit(0);
});
