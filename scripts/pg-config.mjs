export function pgConfig() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const url = new URL(process.env.DATABASE_URL),
    local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "channel_binding"])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: local ? undefined : { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  };
}
