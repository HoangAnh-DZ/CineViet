import { readFile } from "node:fs/promises";
import pg from "pg";
import { pgConfig } from "./pg-config.mjs";
// Supply the explicitly authorized existing account, never auto-promote a signup.
const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (!email) throw new Error("Set ADMIN_EMAIL to the authorized registered admin account.");
const client=new pg.Client(pgConfig());
try {
 await client.connect();await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(839429170)");
 const user=await client.query("SELECT id FROM cinevjet.users WHERE email=$1 AND status='ACTIVE'",[email]);
 if (user.rows.length!==1) throw new Error("Authorized admin account must already be registered and active.");
 await client.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING",[user.rows[0].id]);
 await client.query(await readFile("database/shorts-seed.sql","utf8"));
 await client.query("COMMIT");console.log("Admin membership configured; existing demo clips imported without overwrites.");
} catch {await client.query("ROLLBACK").catch(()=>{});console.error("Shorts setup failed; transaction rolled back. Credentials withheld.");process.exitCode=1;} finally {await client.end();}
