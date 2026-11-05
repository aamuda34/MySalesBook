# Sellbook public launch checklist

Last reviewed: 5 November 2026

This checklist is the release gate for unrestricted public registration. Passing source-level checks does not replace a live end-to-end test.

## Technical release

- [x] Main branch has automated checks for JavaScript/HTML integrity, authentication UI, backups, offline synchronisation, account deletion, reversible product archiving, sale reversals and admin routing.
- [x] All public application tables inspected in Supabase have row-level security enabled.
- [x] The inspected public SECURITY DEFINER functions have a fixed search_path; none are executable by the anonymous role.
- [x] Browser configuration uses a Supabase publishable key; server-side secrets are not part of the browser configuration.
- [x] Product-image storage is private and user-folder scoped. Buybook marketplace images are public by design when sellers publish listings.
- [x] Service worker does not cache Supabase REST, Auth, Storage or Functions responses.
- [ ] Verify that the current main commit is the active Vercel Production deployment and that the primary domain serves that exact release.
- [ ] Run the complete live Android test plan below after the production deployment is updated.

## Live Android acceptance test

Use two separate ordinary seller accounts and two separate devices or browser profiles. Do not use the administrator account for the seller workflow.

1. Register by email, confirm the email, sign in with email, sign in with Google, sign out and recover a password.
2. Set a PIN, verify wrong-PIN lockout, verify PIN expiry, and complete a protected account action.
3. Create, edit, archive and restore products; verify images and category filtering.
4. Record single-item and multi-item sales, sell by pack where configured, review sales history, and reverse a test sale with and without returning stock.
5. Restock products, change stock, add expenses and verify net-profit calculations.
6. Disable connectivity, record a sale, restore connectivity and confirm the sale synchronises exactly once without losing stock or changing another account's records.
7. Export a backup, restore it into a clean test account/device, and verify the restored records.
8. With two accounts, attempt to read or change the other account's product, sales, expenses, images, support messages, feedback, subscribers and reservations. Every cross-account attempt must be denied.
9. Connect a test shop to Buybook, confirm its published image/listing visibility, subscribe from the buyer account, send messages, reserve a product and process the reservation as the seller.
10. Delete the test account after exporting its records. Confirm account-owned cloud data and files are removed and that the second account remains intact.
11. Install the PWA from Chrome, launch it from the home screen, update to a new service-worker version, and verify that offline launch does not expose stale account data.

## Database migration discipline

The live database contains five historical identity-tier migrations that were later superseded by 20261102184946_remove_identity_tier_gates_preserve_buybook_sync.sql. Those retired migrations are intentionally not reintroduced: the later rollback migration removes their triggers/functions if present, and the current product no longer uses the identity-tier gate.

The active migration files whose timestamps differed from the live Supabase history have been renamed to the versions recorded by the database. The remove_unverifiable_whatsapp_gate migration is recorded as applied only after checking that its final marketplace shop constraint is already present. Do not run a blind supabase db push against production while reviewing migration history. Use a dry run and inspect each pending migration first.

## Legal and operator launch gate

- [ ] Supply the operator's legal identity and residence/place of business.
- [ ] Supply a monitored privacy/support contact that prospective users can use without already having an account.
- [ ] Have the Privacy Notice and Terms reviewed against the operator's actual processing activities and applicable Nigerian law.
- [ ] Confirm provider data-processing terms and safeguards for any transfer of personal data outside Nigeria.
- [ ] Decide whether the operator's scale or processing activities require NDPC registration, a Data Protection Officer, or a data protection impact assessment. Obtain qualified advice where needed.

The legal pages deliberately show that the operator details are still outstanding. They must not be presented as complete until the operator supplies those details.
