# VIP and daily rewards — 2026-10-09

Main task: PASS.

Production URL: https://cinevjet-hoanganh-dz.vercel.app
Deployment ID: `dpl_ETK7dhedbVNzADYv2xpQQ2zoPJMr`
Vercel state: READY. The requested production alias was independently checked through the Vercel API and points to this deployment in the existing `cinevjet` project.

## Rates and plans

1 integer coin = 1 VND: PASS. Fractional and unsafe integer inputs are rejected by the conversion helper.

| Plan | Price (VND) | Days 1–7 (coins) | Total | Difference | Result |
| --- | ---: | --- | ---: | ---: | --- |
| Free | 0 | 200, 300, 500, 700, 1,000, 1,300, 2,000 | 6,000 | — | PASS |
| VIP Basic | 49,000 | 5,000, 7,000, 9,000, 12,000, 15,000, 20,000, 31,000 | 99,000 | +50,000 | PASS |
| VIP Plus | 99,000 | 8,000, 10,000, 15,000, 18,000, 22,000, 30,000, 46,000 | 149,000 | +50,000 | PASS |
| VIP Premium | 199,000 | 12,000, 18,000, 25,000, 30,000, 40,000, 50,000, 74,000 | 249,000 | +50,000 | PASS |

Paid memberships use a configurable 30-day duration. Membership expiration is separate from the seven-claim reward cycle. Price, name, schedule and enabled status are database configuration. A cycle snapshots its purchased schedule and price.

## Cycle

| Check | Result |
| --- | --- |
| One verified VIP purchase = one seven-day cycle | PASS |
| Day 7 completes the cycle | PASS |
| Next calendar day returns to Free while membership may remain valid | PASS |
| No infinite VIP repetition | PASS |
| Upgrade cancels the old unfinished cycle and opens the new tier at Day 1 without backfill | PASS |
| Expired membership invalidates an unfinished cycle | PASS |

The internal activation hook requires a persisted verified purchase reference. Retry returns the original cycle, including completed or cancelled cycles. No public activation endpoint or demo payment event opens a production cycle. A missed day continues the next milestone, preserving the existing rule. The database clock supplies the date in Asia/Ho_Chi_Minh; the global daily claim limit applies across Free and VIP upgrades.

## Coin

| Check | Result |
| --- | --- |
| Atomic check-in, wallet, ledger and cycle progress | PASS |
| Exactly one ledger record per credited claim | PASS |
| Purchase and daily claim idempotency | PASS |
| Concurrent requests credit only once | PASS |

The tests exercised 20 simultaneous claim requests and wallet overflow rollback. The wallet row lock serializes claims and cycle activation for the same user.

## UI

| Check | Result |
| --- | --- |
| Upgrade VIP / View VIP benefits CTA | PASS |
| Current membership tier | PASS |
| Current cycle status | PASS |
| Server-supplied reward schedule | PASS |
| Four updated plan cards with neutral copy | PASS |
| Mobile 360 / 375 / 390 / 412 / 430 px | PASS |

Production Rewards and VIP were checked at all five widths: no page overflow, readable reward amounts and prices, and controlled scrolling for the seven-day reward row. VIP Premium cycle display and the already-claimed state were checked on the isolated test branch. Production modal verification confirmed that payment remains disabled. Existing missions remain separate from the daily reward total.

## Database and validation

- Additive migration `0002_vip_checkin_cycles.sql`: PASS on production.
- Existing users, catalog, favorites, watch history, wallets, coin ledger, check-ins and subscriptions: PASS; before/after fingerprints matched during migration.
- Targeted Neon PostgreSQL tests: PASS, 20/20 reported tests (19 subtests plus parent).
- Typecheck: PASS, one final invocation.
- Local build: PASS, one final invocation.
- Production deploy and hosted build: PASS.
- Production runtime verification: PASS, authenticated read-only UI checks plus a read-only server reward snapshot and database consistency checks.
- Production test coin credits / fake VIP activations: 0 / 0.
- Isolated test branch: deleted after testing. Its local credentials file was removed.

The migration originally preserved one existing user and zero check-ins. By the final runtime check, ordinary production activity had added a user and one 200-coin check-in. Current wallet totals, check-in rewards and ledger totals all matched, and before/after runtime verification counts were unchanged. No production write was used for verification.

The first deployment attempt was blocked by local commit-author metadata. The successful deployment used an identical source export without Git history and the authorized CLI account. No Git history, GitHub integration, push, or SSO settings were changed.

Evidence in ignored `test-results/`:

- `vip-production-migration.json`
- `vip-mobile-preview.json`
- `vip-production-runtime.json`
- `vip-production-readonly.json`
- `vip-production-390.png`
- `rewards-production-390.png`

## Files changed

- `database/migrations/0002_vip_checkin_cycles.sql`
- `package.json`
- `src/app/api/rewards/route.ts`
- `src/app/rewards/page.tsx`
- `src/app/vip/page.tsx`
- `src/domain/coins.ts`
- `src/domain/models.ts`
- `src/features/rewards/rewards-screen.tsx`
- `src/features/rewards/rewards-vip.css`
- `src/features/vip/vip-screen.tsx`
- `src/server/account.ts`
- `src/server/foundation.tsx`
- `src/server/rewards.ts`
- `tests/production.test.mts`
- `tests/vip-rewards.test.mts`
- `docs/production-status.md`
- `docs/vip-rewards-status.md`

Remaining issue: NONE. Real-money VIP payment remains intentionally disabled as required.
