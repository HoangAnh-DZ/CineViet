# Rewards, library and Admin UI — 2026-10-09

Scope: upgrade the existing dark CineVjet UI, replace the Wallet bottom tab with a real personal library, and add the Admin dashboard. Existing movie/player, VIP schedules, coin ledgers, cash balances and Shorts upload storage are preserved.

## Delivered

- Rewards: optimized 24 KB transparent gold coin asset; navy/gold balance card, clear membership, consistent check-in tiles, dimensional check-in button and withdrawal link to the existing cash wallet route.
- Navigation: Khám phá, Phim ngắn, Phần thưởng, Danh sách, Của tôi. One Lucide icon set with muted color and clear active state. Legacy wallet routes remain available from the profile.
- Library `/list`: real watch history, episode/progress/continue links, saved movies and persistent saved Shorts, current-user removal, authenticated and empty states. Client navigation refreshes the library; removals refresh account state.
- Admin `/admin`: separate desktop layout and mobile drawer, completed cash-in and cash-out totals, net difference before operating costs, real user counts, 30-day and full 12-month charts, recent transactions and users.
- `/admin/videos`: search/type/status filters, add/edit, poster/video preview, view, reversible hide, pagination, and access to the existing Shorts manager. Publication requires a video source. Existing sources remain unchanged on metadata-only edits.
- `/admin/finance`: actual deposit/withdrawal records and filters, fees and payout amounts. No simulated payment completion.
- `/admin/users`: search, details, lock/unlock; locking revokes sessions. Self/admin locking is prevented. Password hashes and session tokens never reach the UI.
- `/admin/rewards`: actual balances, issued coins, check-ins, active memberships and current tier schedules.
- Admin entry appears in the profile only for an existing authorized Admin. All Admin reads/writes enforce that role server-side.
- Fixed a stale autoplay promise that could pause Shorts after reload. Active/next preload, single-player control and comments pause/resume remain intact.

## Validation

- Typecheck: PASS (`npm run typecheck`).
- Production build: PASS (`npm run build`, Next 16.4).
- Targeted tests: 49/49 passing, including suite containers. 47 individual test cases cover dashboard/library persistence and access, existing Admin Shorts security, and streaming/navigation behavior.
- Browser: 18/18 flows passing, zero page errors, isolated PostgreSQL fixtures only. Real UI add/edit/hide and lock/unlock were tested without production record changes.
- Mobile: 360, 375, 390, 412 and 430 px; Rewards/nav/library and every Admin screen checked without document overflow. Desktop Admin: 1280 and 1440 px. Screenshots visually inspected.
- `0004_saved_shorts.sql` applied to production using direct Neon connection. It only adds the personal bookmark table and index. Fingerprints of all 17 pre-existing protected tables match the read-only baseline exactly.
- Reproducible service tests: `npm run test:dashboard`. Browser fixture scripts and evidence are in ignored `test-results/`.

## Main files

`src/app/premium-ui.css`, `src/components/ui.tsx`, `src/components/navigation.tsx`, `src/components/providers.tsx`, `src/domain/navigation.ts`, `src/features/rewards/rewards-screen.tsx`, `public/images/reward-coin.webp`, `src/app/list/page.tsx`, `src/features/library/`, `src/server/library.ts`, `src/app/api/library/`, `src/app/admin/`, `src/features/admin/`, `src/server/dashboard.ts`, `src/app/api/admin/movies/`, `src/app/api/admin/users/`, `src/server/admin-core.ts`, `src/app/profile/page.tsx`, `src/features/profile/profile-screen.tsx`, `src/features/shorts/short-actions.tsx`, `src/features/shorts/short-video-item.tsx`, `database/migrations/0004_saved_shorts.sql`, `tests/dashboard-library.test.mts`, `tests/streaming.test.mts`.

## Existing functional limitations

Cash payment processing and reward missions remain disabled/unimplemented as before. The requested withdrawal button opens the existing withdrawal screen; it does not simulate a cash payout. Admin "Tổng lãi" explicitly means completed inflows minus net payouts before operating costs. No known remaining issue within the requested UI/Admin/library scope.

## Production release

Deployment `dpl_GR7oUS5LP5gBW751c5Er57LoEEQJ`: READY, production, project `cinevjet`, team `hoanganh-dzs-projects`. Alias `https://cinevjet-hoanganh-dz.vercel.app` points to this exact deployment. Hosted build passed.

Production UI verification passed: Rewards retains the real 200-xu balance; the new coin asset loads; the exact five tabs and withdrawal link render. The existing authorized Admin reaches the dashboard, 12 real films, 3 users, 4 current reward tiers and actual zero completed cash transactions. Daily/monthly chart switching works. A temporary bookmark of the existing legal sample Short persisted after reload and appeared in the library; removing it restored the original empty saved list. Shorts had one playing video and two preloaded sources. The temporary tabs were closed and viewport overrides reset. No browser errors were captured. Production data fingerprints still match all 17 protected tables after runtime verification.

Screenshots: `test-results/rewards-production.png`, `test-results/dashboard-production.png`. No GitHub push.
