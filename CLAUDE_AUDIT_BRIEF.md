# CLAUDE AUDIT BRIEF — SELLBOOK + BUYBOOK

## Mission
Act as an independent principal engineer, security reviewer, product architect and senior mobile-first UX/UI designer. Conduct a thorough, evidence-based, READ-ONLY audit of both applications and their shared Supabase architecture. Produce a professional assessment and upgrade proposal. This first phase is audit only: **do not edit files, create pull requests, deploy, run migrations, change settings/data, rotate keys or take destructive actions.**

For every confirmed code issue, cite exact file path, function and line range, explain user impact and severity, and suggest a safe correction. Separate confirmed bugs from risks, missing tests and improvement ideas. Do not invent findings or claim tests ran when they did not.

## The products
- **Sellbook** is the seller-facing phone-first business-management PWA for Nigerian small shops: sales, products, stock/restocks, expenses, profit/history, reservations, customers, messages, notifications, settings and administration. It is the source of truth for connected seller products and shop information.
- **Buybook** is the buyer-facing marketplace for discovering local shops/products, checking details and listed prices, following shops, messaging, reserving products and finding shops.
- Seller product information should flow automatically from Sellbook to Buybook; sellers should not manually republish inventory.
- Both use the same Supabase project for Auth, Postgres, Storage and Realtime. Sellbook is deployed via Vercel; Buybook is a Cloudflare Worker with embedded static assets.

Production: Sellbook https://my-sales-book.vercel.app/ · Buybook https://buybook.aamuda34.workers.dev/

## Which code is authoritative
1. Sellbook: inspect the entire repository root, `aamuda34/MySalesBook`, including HTML, CSS, JavaScript, service worker, legal pages, configuration, SQL migrations and test/build files.
2. Buybook: authoritative active-production snapshot is `buybook-production/worker.js` plus every file under `buybook-production/static/`. Extracted from the live Cloudflare Worker named `buybook` on 2026-11-12. The Worker embeds its front-end files in a `FILES` object; both deployed module and individual assets are included.
3. The older `aamuda34/IBuy` repository is historical and may be stale. Do not assume it is current unless compared against the deployed Worker.
4. Live Supabase structure, function inventory, storage buckets and current public RLS policies are in `SUPABASE_LIVE_SCHEMA_OVERVIEW.md`. No real user/business records were exported.

This handover is on branch `claude-audit-handover-20261112`. Review only; do not merge it into `main` or deploy it.

## Principles and constraints
- Keep the apps simple, understandable, dependable and fast on phones, including budget Android devices and variable mobile networks in Nigeria.
- The owner has no coding background and a very limited/no budget. Prefer low-cost/free, maintainable improvements. Identify real costs and free-tier limits.
- Avoid over-engineering, crowded screens, novelty features, decorative “AI-looking” UI or unnecessary framework rewrites. Assess the existing vanilla JS/PWA architecture on evidence; recommend migration only with measurable reasons, transition risk, maintenance burden and cost.
- Preserve working features, data, users, URLs, PWA installability, browser Back behavior, authentication and existing records. Unsynced phone work must not be silently overwritten by stale cloud state.
- Sellbook: green primary around `#14532d`, Naira (₦), tagline “Made Business Simple.” Buybook: purple primary around `#452265`, tagline “Check Before You Go.” Keep separate brand identities but create a coherent design family.
- Aim for restrained, modern, trustworthy and accessible interfaces, not enterprise complexity.

## Intended flows to verify
### Sellbook
- Home dashboard prioritizes Sales, Net profit, Approaching customers and Reservations. Approaching customers opens a dedicated map page; the live map should not render on Home.
- Product create/edit, individual units/packs, sales/reversals, restocking, stock adjustments/history, expenses, profit history/reports.
- Notifications, support/messages, Me/settings, Connect to Buybook, subscribers/reservations and separate admin area.
- Google/email full-page authentication, email verification, six-digit PIN lock and safe reauthentication for sensitive account/PIN actions.
- Offline local preservation + cloud sync, clear sync conflicts/retry/recovery, safe service-worker updates.
- Connected Buybook details read-only with a settings entry; never connected shows Connect; disconnected-after-previous-connection shows Reconnect.
### Buybook
- Guest browsing; registration/subscription requirements for follow/message/reservation according to actual code/policies.
- Discover/search products/shops/categories, product/shop details, buyer account, reservations, messages, notifications and directions.
- Seller listings originate from Sellbook.
- One-time buyer GPS is requested only after the buyer taps Get route and is not sent to seller. Live sharing is separate, explicitly optional and time-limited.
- Distinguish saved shop pin, seller-confirmed entrance pin, device-reported accuracy, straight-line distance and estimated road route/time. Never claim “arrived” just because a coordinate was reached.
- Respect consent, stop sharing, expiry, accuracy and RLS.

## Audit work
### 1. Architecture/inventory
Map every file, entry point, dependency, deploy path, service worker, external service, Worker endpoint and database interaction. Describe browser/Vercel/Cloudflare/Supabase/Storage/Realtime/route/tile trust boundaries. Identify duplicate/dead code, version drift, unversioned production source, hidden assumptions and release-reproducibility gaps.

### 2. Correctness/reliability
Trace sign-in, PIN unlock, startup/refresh, offline/reconnect, product create/edit, restock, sale, reversal, expenses, calculations, product sync, reservation, approve/reject/cancel, messages, notifications, map/route/live sharing, account deletion and admin. Inspect races, double submits, async failures, null DOM assumptions, stale sessions, duplicate IDs, back behavior, data integrity, idempotency, stale caches, lost updates, silent failures and invalid state transitions. Verify units/packs, stock math, profit definitions, date/time-zone (Africa/Lagos), Naira formatting, archived items and reservation expiry. Check all loading/empty/error/retry/success states.

### 3. Security/privacy — highest priority
Audit every public table/RLS policy, SQL function/trigger/view, storage bucket and Worker endpoint. Examine SECURITY DEFINER functions, safe search_path, grants/revokes, ownership checks, IDOR/BOLA, user metadata trust, admin roles, PIN controls and session lifetime. Verify public marketplace reads expose only intended active listing/shop fields; private seller records, messages, reservations, notifications, attachments and GPS sessions are restricted to authorized users. Check attachment paths, XSS/HTML injection, unsafe URLs, OAuth redirects, security headers, abuse/rate limits, PIN brute force, account deletion and retention. Never exploit production or access another user's data.

Do not request or disclose service-role keys, Cloudflare secret values or passwords. Binding names are documented, values omitted. A publishable browser key is not a service-role key; still verify no privileged secret is bundled into client code or repository.

### 4. Performance/accessibility/PWA
Review startup weight, bundle size, long tasks, unnecessary requests, N+1 reads, pagination, large DOM lists, image loading, memory/realtime cleanup, retry logic, indexes/query shape, caching and service-worker updates. Assess low-end Android, small screens, touch targets, contrast, font scaling, keyboard/screen reader semantics, focus, reduced motion, labels and validation. Verify installability, manifest/icons, offline shell, cache versioning and update behavior.

### 5. Product + UX/UI
Review full information architecture and important screens. Identify navigation clutter, repeated actions, poor hierarchy, unclear copy, friction, dead ends and buyer/seller handoff gaps. Propose one recommended modern design direction per app, preserving brand identities with compatible design foundations. Deliver semantic colour tokens, type scale, spacing, radii, elevation, component states, buttons/forms/cards/nav/dialogs, accessibility and mobile breakpoints. Provide screen-by-screen redesign recommendations and text wireframes for key screens. State what to retain, simplify, consolidate, remove and add. Every proposal must improve usability, speed, clarity, trust or conversion.

### 6. Business readiness/roadmap
Identify missing public-launch essentials: privacy/consent, terms, support, account lifecycle, moderation/reporting/blocking, monitoring/alerts, backups/restore, incident response, onboarding, analytics, app status and release process. Evaluate marketplace trust, seller onboarding, listing freshness, stock accuracy, reservation reliability, buyer safety and local discoverability. Prioritize P0 blockers, P1 reliability/security/design-system work and P2 growth/future improvements. Estimate effort, dependencies and recurring cost; flag what is not viable without budget.

## Required deliverables
1. Separate readiness rating for Sellbook and Buybook; executive summary.
2. Architecture/feature inventory and data-flow map.
3. Confirmed bugs with severity, exact evidence, repro/test and correction.
4. Security/privacy report with risk, preconditions, impact and remediation.
5. Reliability/performance/accessibility/PWA report.
6. Supabase/Worker audit: RLS, functions, grants, indexes/query patterns, storage, endpoints, rate limits, lifecycle and schema drift.
7. Professional modern design proposal for both apps: tokens, screen maps, wireframes and microcopy.
8. Product gaps and major upgrades with value, cost, effort and dependencies.
9. Phased P0/P1/P2 roadmap with acceptance criteria.
10. Test strategy and exact list of tests not executed.
11. Top 10 highest-value improvements that make both apps more professional without making them complicated.

Be candid and evidence-based. State what could not be inspected. Do not treat deployment READY as proof that app flows work. Do not implement anything in this first phase; conclude with recommendations and wait for owner approval.
