# CineVjet / CINEMA

Next.js 16.4, React, TypeScript, Drizzle and PostgreSQL. Existing mobile UI, Nunito Sans and Lucide are preserved. Production routes use server repositories; mock catalog/account adapters are restricted to fixtures and legacy tests.

## Configure and run

Use Node 24. Copy `.env.example` to `.env.local` and configure these variables privately:

- `DATABASE_URL`: pooled Neon PostgreSQL connection string (PostgreSQL 15 or newer).
- `AUTH_SECRET`: independently generated random secret, at least 32 characters. Never reuse the verification/test secret.
- `NEXT_PUBLIC_APP_URL`: exact application origin, localhost for local development, assigned Vercel production origin for deployment.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Migrations use a journal, checksum validation, transaction-scoped advisory lock and rollback. `database/migrations/0001_production.sql` creates the dedicated `cinevjet` schema without modifying public/demo tables. Existing populated schemas require migration review; never drop them to retry. Seed is idempotent and inserts 12 fictional movies, 4 series / 40 episodes, genres, sample source/subtitle metadata and 4 VIP plans. It does not insert users or financial activity.

## Verification

```sh
npm test
npm run test:production
npm run test:mobile
npm run typecheck
npm run build
```

Repository tests use isolated PostgreSQL via PGlite, not a mock SQL adapter and not Neon. Browser verification requires a running app backed by a migrated database and installed Chrome, and registers clearly marked test accounts. `BASE_URL` selects the deployed origin. It exercises register/session/login/logout, server protection, favorites, video progress/resume, search, inactive cash actions and all five mobile widths. Do not run against an environment without authorization to create test accounts.

For isolated local browser checks, run `node scripts/test-database.mjs`, configure a separate ignored verification env with its localhost connection, run migrations/seed, and start the app with that env supplied to its process. The local verification database is never a production fallback.

## Behavior

- Passwords are bcrypt hashes (cost 12). Opaque session tokens have 256-bit randomness; the database stores HMAC digests, not bearer tokens. Cookies are HttpOnly, SameSite=Lax and Secure with a `__Host-` prefix in production. Sessions expire after 1 day or 30 days with remember enabled and are revoked on logout. No authentication or library data is stored in localStorage.
- Auth inputs are validated and normalized server-side. Database-backed email/IP attempt windows limit login/register. Mutation handlers validate the exact Origin. All user-data handlers derive user ID from the session, and SQL values are parameterized through Drizzle.
- Protected pages: profile, rewards, wallet and nested wallet pages, favorites and history. Streaming page redirects may have HTTP 200 with a server-generated redirect; API access still returns 401.
- Catalog, metadata, genres, published episodes, related movies and playback metadata are database queries. Explore/search use 12-item pages, server filters and a 300 ms debounce.
- Favorites are unique per user/movie. Progress uses a NULLS NOT DISTINCT unique constraint per user/movie/episode, server bounds, and a 15-second save interval plus pause/end/page exit. Continue watching joins real movie metadata and sorts by latest progress; completed items are excluded from Home.
- Coin/check-in/VIP/cash schemas are prepared. Wallet and coin balances start at zero, ledgers are empty. Check-in/reward payouts and deposit/withdraw/VIP purchases are disabled. Old demo APIs return 410. VIP permissions are derived from live server subscriptions and expiry.
- Social login and password reset are explicit placeholders. No payment gateway, full admin, DRM, HLS library, custom domain or streaming CDN is enabled.

## Deployment

Private repository: https://github.com/HoangAnh-DZ/cinevjet

Vercel project: `cinevjet`, ID `prj_pS99SOdXtn13R4CD2XyIvmBgimCA`, Node 24, Singapore region. Set the three variables in Production, migrate/seed Neon, pass the checks, connect the repository and deploy Production. Then verify the actual assigned URL with `BASE_URL`. Database credentials and `.vercel` files must remain ignored. Deployment status is recorded separately in `docs/production-status.md`; the existence of the project or a build does not prove deployed runtime success.

## Assets

Catalog illustrations are original AI-generated assets in `public/images`. The local sample is [Big Buck Bunny](https://peach.blender.org/) by Blender Foundation, CC BY 3.0, served originally by [W3C](https://media.w3.org/2010/05/bunny/trailer.mp4). It is a sample clip unrelated to the fictional titles. Vietnamese subtitles are illustrative.

The query implementation follows [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) and [transactions](https://orm.drizzle.team/docs/transactions). Local verification uses [PGlite Socket](https://pglite.dev/docs/pglite-socket).
