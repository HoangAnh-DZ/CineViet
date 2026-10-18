# Production status — 2026-10-09

Latest production release: manual bank deposit/withdrawal and Admin finance review, PASS.

Current deployment: `dpl_8aSUY82tqmJ5ssUj5L46YFgya9xy`, READY. The production domain points to this exact deployment. Manual review only; TPBank bill uploads use the existing Blob store, pending deposits do not credit, withdrawals reserve funds and require manual transfer confirmation. 51/51 targeted cases, typecheck/build and 18/18 runtime checks passed. Additive migration 0005 applied; 19 existing tables retain their data, balances and ledgers. No real financial transaction was created or approved during production verification. See [Manual money verification](manual-money-status.md).

Previous Rewards/Admin deployment: `dpl_GR7oUS5LP5gBW751c5Er57LoEEQJ`, READY at release time. Its typecheck/build, 49 targeted tests, 18 isolated browser flows, five mobile widths and desktop 1280/1440 passed. Additive bookmark migration applied; 17 pre-existing protected tables remained identical. Real production Rewards, Admin data and bookmark save/reload/remove passed. See [Rewards and Admin UI verification](rewards-admin-ui-status.md).

Previous Admin Shorts release: `dpl_3oZDcZrD4XFSkeEGDQcLybknoami`, READY at release time. See [Admin Shorts verification](admin-shorts-status.md) for its historical checks and storage setup.

Previous actual Shorts feed release: `dpl_81Ng7JKHD2ARmzrBXNCy27t75sdB`. See [Actual Shorts feed verification](shorts-feed-status.md) for its historical data comparison and checks.

Previous full UI release: `dpl_BnHDaLjAFmB7DgzJB88z1iu7ByZx`. Its 13/13 tests, 37/37 preview checks and 25/25 production layouts are historical. See [Streaming UI verification](streaming-ui-status.md).

Previous VIP release: `dpl_ETK7dhedbVNzADYv2xpQQ2zoPJMr`; its targeted tests were 20/20. See [VIP and rewards verification](vip-rewards-status.md) for the preserved business rules and historical evidence. Those business tests were not rerun for this presentation-only release.

The sections below record the previous backend integration release from 2026-10-08; its test counts are historical and were not rerun for the scoped UI task.

## Previous backend integration release

Main task: PASS.

Production URL: https://cinevjet-hoanganh-dz.vercel.app
Deployment ID: dpl_7Khxf6gtpoKVLPHcUzs5sBg5GfNZ
Vercel state: READY, target production, Node.js 24, functions in sin1.

## Neon

Dedicated project: cinevjet-production (`shy-cloud-45110262`).
Organization: org-lively-breeze-11543344. Region: aws-ap-southeast-1.
Production branch: main (`br-sparkling-art-b3p3erx4`), PostgreSQL 18.
The application uses a pooled, TLS-verified connection to its own cinevjet database.

| Check                                          | Result                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DATABASE_URL configured server-side            | PASS                                                                                                               |
| Existing 0001_production.sql migration applied | PASS                                                                                                               |
| Production-safe seed applied                   | PASS                                                                                                               |
| Database verification                          | PASS: 22 tables, 12 generated movies, 8 genres, 4 series, 40 episodes, 52 video sources, 52 subtitles, 4 VIP plans |
| Seeded users / balances / money transactions   | 0                                                                                                                  |

Migration and seed ran transactionally. No database was dropped or reset. RENTA was not used.

## Auth

| Check               | Production result |
| ------------------- | ----------------- |
| Register            | PASS              |
| Login               | PASS              |
| Session / reload    | PASS              |
| Logout / revocation | PASS              |
| Protected routes    | PASS              |

Browser verification confirmed HttpOnly, Secure, SameSite=Lax session cookies, rejection of anonymous writes and incorrect passwords, and authenticated profile rendering.

## Data

| Check                      | Production result |
| -------------------------- | ----------------- |
| Movie catalog from Neon    | PASS              |
| Explore                    | PASS              |
| Search from database       | PASS              |
| Movie detail               | PASS              |
| Episodes                   | PASS              |
| Favorites                  | PASS              |
| Watch history              | PASS              |
| Continue watching / resume | PASS              |

A direct Neon query independently confirmed the browser-created favorite and 10 seconds of saved progress. The temporary test account and its associated rows were then removed.

## Vercel

| Check                     | Result                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Existing project reused   | PASS: actual project name cinevjet, ID prj_pS99SOdXtn13R4CD2XyIvmBgimCA                                       |
| Requested domain assigned | PASS: cinevjet-hoanganh-dz.vercel.app is a production alias of this existing project                          |
| Direct local CLI deploy   | PASS                                                                                                          |
| Production env            | PASS: DATABASE_URL and AUTH_SECRET stored as secrets; NEXT_PUBLIC_APP_URL equals the requested production URL |
| Production deploy         | PASS: READY                                                                                                   |
| Runtime verification      | PASS: 48/48 browser checks                                                                                    |
| Mobile widths             | PASS: 360 / 390 / 430                                                                                         |

The deployment came directly from this workspace through Vercel CLI. GitHub linking, pushing and SSO changes were not used.

## Validation

- Targeted integration tests: PASS, 23/23 reported tests (22 subtests plus parent).
- Typecheck: PASS, npm run typecheck, one final invocation.
- Local build: PASS, npm run build, one final invocation.
- Vercel hosted build: PASS.
- Production browser checks: PASS, 48/48, using VERIFY_TARGETED=1.
- Money actions enabled: NO. Deposit, withdrawal and legacy demo payment routes remain disabled. The test account had cash and coin balances of zero and no money ledger entries.

Evidence:

- test-results/production-browser-report.json
- test-results/neon-production-persistence.json
- test-results/production-mobile/home-360.png
- test-results/production-mobile/home-390.png
- test-results/production-mobile/home-430.png

## Files changed in this task

- scripts/verify-production.mjs: optional targeted mode for the requested routes and three widths; default full mode retained.
- docs/production-status.md: verified production outcome.
- .env.local and .vercel/project.json: ignored local configuration; no secret values recorded in this report.
- test-results/: ignored verification scripts, reports and screenshots.

Remaining issue: NONE.

## Admin Shorts production — 2026-10-09

Admin Shorts: PASS. Deployment `dpl_3oZDcZrD4XFSkeEGDQcLybknoami` is READY and serves https://cinevjet-hoanganh-dz.vercel.app. Admin route: `/admin/shorts`; the explicitly authorized registered account has been granted membership using existing authentication. Feed reads Neon metadata; actual video/thumbnail Blob uploads passed runtime verification. 16/16 targeted browser flows, 16 DB/security checks and 17 streaming checks passed. Final typecheck/build passed. Migration only adds Shorts/admin/upload tables; 14 existing table fingerprints stayed unchanged. See [admin-shorts-status.md](admin-shorts-status.md) for evidence and files. No GitHub push. Remaining issue: NONE.

## Streaming user interface — 2026-10-09

PASS. Deployment `dpl_FqVuFerEevH5MQdbSReBSp4Kr1bJ` is READY and the production alias points to it. Content-led Explore, library, Rewards, Profile and five-tab navigation were visually compared at 390×844 and 1440×900. Latest 46 UI checks + 26 related logic checks, final typecheck/build and 19 production runtime checks passed. All 17 protected Neon table fingerprints remained unchanged. Direct Vercel deploy, no GitHub push. [Full verification and changed files](streaming-ui-status.md). Remaining issue: NONE.
