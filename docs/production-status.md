# Production status — 2026-10-07

Main task: FAIL / blocked on production database configuration. This document distinguishes verified local behavior from deployed behavior.

| Area | Result | Evidence / limitation |
| --- | --- | --- |
| Neon connected | FAIL | Neon connector requires a project ID; no project ID or DATABASE_URL was supplied. The available connector lacks create/list-project tools. |
| Migrations | PASS locally; FAIL on Neon | `0001_production.sql` applied transactionally to isolated local PostgreSQL. Not applied to Neon. |
| Seed | PASS locally; FAIL on Neon | 12 fictional movies, 4 series, 40 episodes, genres and VIP plans. Idempotency verified. No seeded users/money activity. |
| Register / Login / Session / Logout / Protected routes | PASS locally | PostgreSQL tests and browser → API → PostgreSQL verification. No production runtime verification yet. |
| Real database catalog / Explore / Search / Detail / Episodes / Video source | PASS locally | Parameterized server repositories; 12-item pagination and 300 ms debounce. Local PostgreSQL, not fixtures in the production path. |
| Watch progress / Continue watching / Favorites | PASS locally | Server user scoping, bounds, idempotent unique writes, native-player save/resume and browser reload. |
| Coin / Daily check-in / VIP / Wallet schemas | PASS locally | Migration applied and constraints tested. Not migrated to Neon. |
| Real-money actions enabled | NO | Cash actions and VIP purchase disabled; legacy demo APIs return 410. |
| GitHub repository | CREATED | https://github.com/HoangAnh-DZ/cinevjet (private). Push status is finalized after commit. |
| Vercel project created | PASS | `cinevjet`, `prj_pS99SOdXtn13R4CD2XyIvmBgimCA`. |
| Vercel Production env | INCOMPLETE | AUTH_SECRET and NEXT_PUBLIC_APP_URL configured; DATABASE_URL is missing. No values recorded here. |
| Vercel production deploy | FAIL / not started | No deployment is claimed without the production database. |
| Vercel runtime verification | FAIL / not run | There is no completed production deployment. |
| Production URL | NOT LIVE | Reserved production domain: `cinevjet-hoanganh-dz.vercel.app`. Domain assignment is not deployment success. |
| Mobile 360 / 375 / 390 / 412 / 430 | PASS locally | 16 pages × 5 widths, no horizontal overflow, Nunito Sans preserved. |
| Targeted tests | PASS | 5 domain tests + 22 PostgreSQL functional subtests; 95 browser checks. Node reports 23 for the PostgreSQL suite including its parent test. |
| Typecheck | PASS | `npm run typecheck`. |
| Build | PASS | `npm run build`, Next.js 16.4, all database routes dynamic. |

Automatic approval review rejected a requested Vercel SSO protection change because changing persistent access controls was not explicitly authorized. The change was not applied or retried through another mechanism. Default Standard Protection is retained. No protection change is required for the assigned production domain; deployment URLs remain protected according to Vercel's standard policy.

## Exact remaining dependency

Owner must provide a Neon Project ID that the connected Neon tool can access, or configure DATABASE_URL privately in `.env.local` / Vercel Production. Do not paste credentials into chat. Once available: inspect the target branch, run the additive migration and seed, configure the missing Production env, connect GitHub, deploy the passing commit to Production, and run the same runtime verification at its assigned production origin.

## Files changed for integration

- `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `vercel.json`.
- `database/migrations/0001_production.sql`, `database/seed.sql`.
- `scripts/migrate.mjs`, `scripts/seed.mjs`, `scripts/pg-config.mjs`, `scripts/generate-seed.mts`, `scripts/test-database.mjs`, `scripts/verify-production.mjs`.
- `tests/production.test.mts`.
- `src/server/db.ts`, `auth-core.ts`, `auth.ts`, `http.ts`, `validation.ts`, `catalog.ts`, `account.ts`, `watch.tsx`, `foundation.tsx`.
- `src/lib/format.ts`, `src/services/client.ts`, `src/domain/models.ts`.
- `src/app/api/auth/[action]/route.ts`, `api/account/route.ts`, `api/catalog/route.ts`, `api/favorites/route.ts`, `api/progress/route.ts`; old demo route handlers now return 410.
- Home, Explore, Search, Movie, Watch, Profile, Rewards, Wallet, Favorites, History and VIP route wrappers now load database data or enforce server sessions.
- Shared provider, movie components, navigation, IconButton and finance formatting bindings.
- Feature screens for auth/catalog/home/player/profile/rewards/wallet/VIP, limited to data/auth integration and disabled money actions.
- `README.md`, `docs/architecture.md`, this status document.

Environment variables required: DATABASE_URL, AUTH_SECRET, NEXT_PUBLIC_APP_URL.
