# Production integration boundaries

`src/server/` owns database access, credential hashing, session validation, catalog queries, user-data mutations and foundation reads. Every server module is protected by `server-only`; client screens consume serializable results or same-origin API handlers. Drizzle parameterizes SQL, with node-postgres pooled connections and certificate validation for remote databases. The pool contains connection infrastructure only, never shared per-user data.

`cinevjet` is the production schema. The original `database/schema.sql` remains historical documentation and is not applied. The numbered migration journal is the sole migration source. Catalog IDs are text so existing public route IDs survive; user/session/ledger IDs use random UUIDs. Composite episode foreign keys reject cross-movie references, nullable episode history uniqueness requires PostgreSQL 15+, and balances use bounded integer types.

Registration atomically creates user, zero cash/coin wallets and session. Duplicate email races converge on a unique normalized email constraint. Favorite insertion/deletion is a single idempotent atomic statement. Progress upserts use the session user ID and unique movie/episode scope. Future payouts must lock wallets, insert ledger and update balance in one transaction; future withdrawals must reserve balance before asynchronous provider processing. No payout or financial mutation endpoint is currently enabled.

Movie sources store URLs only. MP4 uses the native adapter; HLS/DASH remain adapter extension points and report unsupported formats. Published source URLs are returned only after server VIP checks. The sample clip is public; its local URL is not a protected commercial streaming implementation. Real restricted content will require server-minted playback URLs from an authorized provider.

Session cookies hold a random opaque token, with HMAC digest stored in the database. Secure/HttpOnly/SameSite attributes are server-set; no bearer tokens or profiles are restored from browser storage. Mutations require the configured application Origin and an active unexpired session. Login/register attempt windows are database-backed; future maintenance can prune expired sessions and old attempt windows. Auth email verification, password reset, social identity and account-email changes require later provider work and are not claimed as available.

Home, Explore, Detail and Watch use database repositories. Search filters and pagination execute in SQL; the browser never downloads the complete catalog to filter it. Account data is user-scoped and queried in parallel. Mock adapters remain fixture-only and old demo API routes return 410.

The schema and repository layer are ready for later admin work. Add server roles, authorization and audit records before exposing administration. No admin UI exists.
