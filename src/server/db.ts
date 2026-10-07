import "server-only";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
const state = globalThis as typeof globalThis & { cinevjetDatabase?: NodePgDatabase };
export function database(): NodePgDatabase {
  if (state.cinevjetDatabase) return state.cinevjetDatabase;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình.");
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  // Strip sslmode so pg cannot replace certificate verification with sslmode=require semantics.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "channel_binding"])
    parsed.searchParams.delete(key);
  const pool = new Pool({
    connectionString: parsed.toString(),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
    ssl: local ? undefined : { rejectUnauthorized: true },
    statement_timeout: 15000,
  });
  pool.on("error", () => console.error("Database connection failed."));
  state.cinevjetDatabase = drizzle(pool);
  return state.cinevjetDatabase;
}
