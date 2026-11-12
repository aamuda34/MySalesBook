# Audit handover snapshot

This branch provides source for both production apps without changing production code.

- Sellbook: repository root, based on `main` when the branch was created.
- Buybook: active production Cloudflare Worker and exact embedded static assets under `buybook-production/`, extracted 2026-11-12.
- Shared database structure and policy/function inventory: `SUPABASE_LIVE_SCHEMA_OVERVIEW.md`.
- Full reviewer instructions: `CLAUDE_AUDIT_BRIEF.md`.

Production: https://my-sales-book.vercel.app/ · https://buybook.aamuda34.workers.dev/
GitHub: https://github.com/aamuda34/MySalesBook
Branch: `claude-audit-handover-20261112` (audit only; do not merge/deploy).

Buybook active Worker deployment: `dde06b5c-a344-4a85-aea2-e3b3dea6b68d`; active version `55fd45b2-9d99-4ac0-b1ec-9f2c73440088`; observed traffic 100%.
Cloudflare bindings are named `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; values intentionally excluded. Supabase project ref: `ueyqrbyqicfpvnznnyxj`.

This snapshot excludes Cloudflare secret values, Supabase Auth settings, production data, Vercel secrets/settings, deployment logs and analytics. Never request service-role keys, passwords or real customer/business records.
