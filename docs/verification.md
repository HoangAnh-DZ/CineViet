# UI foundation verification

Main task: PASS (UI foundation scope).

Reference was checked visually against screenshots at 390 × 844. PASS refers to layout, visual hierarchy, dark/red tokens, card structure, controls and navigation. Movie names, original generated artwork and sample playback intentionally use development fixtures; this is not a pixel-identical copy of copyrighted content.

| Reference screen | Result |
| --- | --- |
| Home | PASS |
| Movie Detail | PASS |
| Watch | PASS |
| Rewards | PASS |
| Wallet | PASS |
| VIP | PASS |
| Explore | PASS |
| Profile | PASS |
| Login/Register | PASS |

| Mobile width | Routes checked | Overflow | Result |
| --- | --- | --- | --- |
| 360 | 17 | None outside intended scroll rows | PASS |
| 375 | 17 | None outside intended scroll rows | PASS |
| 390 | 17 | None outside intended scroll rows | PASS |
| 412 | 17 | None outside intended scroll rows | PASS |
| 430 | 17 | None outside intended scroll rows | PASS |

| Foundation | Result |
| --- | --- |
| Routing | PASS |
| Shared components | PASS |
| Movie mock data | PASS |
| Player shell | PASS |
| Coin architecture | PASS |
| Daily check-in architecture | PASS |
| Wallet architecture | PASS |
| VIP architecture | PASS |
| Typecheck | PASS |
| Production build | PASS |

Evidence: `test-results/mobile-report.json`, 17 screenshot captures under `test-results/screens/`, and reference comparison strips under `test-results/reference-review-*.png`. The mobile matrix has 85 checks; 11 interaction flows passed with no unexpected browser console/runtime errors. Five domain tests passed (timezone midnight boundary, check-in states, currency validation, withdrawal calculation, VIP expiry/permissions). Final Next.js build compiled and generated all requested routes successfully.

Interaction coverage: five-tab navigation; text search and genre filtering; favorite add/reload/remove; HTML5 playback, seek, volume, subtitle selection, fullscreen, resume and episode changes; UI check-in followed by five concurrent repeat requests; deposit confirmation and pending history; server amount validation, idempotent replay and conflicting payload; withdrawal limits, fee and confirmation; pending VIP payment preserving the entitlement gate; login, registration and profile settings; invalid movie/episode not-found UI. Next.js streaming not-found responses may legitimately retain HTTP 200, while rendering not-found content and a noindex meta tag; non-streamed responses return 404.

Files created: package/configuration files; `src/app/` route entrypoints; `src/components/` shared UI; `src/features/` screen compositions; `src/domain/` typed models/rules; `src/data/` fixtures; `src/services/` adapters/contracts; `database/schema.sql`; `public/images/` artwork; `public/video/bunny-trailer.mp4`; `public/subtitles/demo-vi.vtt`; `tests/domain.test.ts`; `scripts/verify-mobile.mjs`; README and architecture/verification documentation. Next.js created AGENTS.md with its current-version guidance.

Remaining issue: NONE within the requested UI phase. Real authentication, provider settlement, durable ledgers, distributed claim concurrency and HLS/DASH adapters require production integration as documented in architecture.md. No production financial backend has been represented as complete.
