# Sellbook public launch checklist

Last reviewed: 5 November 2026

This checklist is the release gate for unrestricted public registration. A successful deployment or automated source check does not replace live end-to-end acceptance or professional legal/regulatory sign-off.

## Technical release

- [x] Main branch has automated checks for JavaScript/HTML integrity, authentication UI, backups, offline synchronisation, account deletion, reversible product archiving, sale reversals and admin routing.
- [x] Public application tables inspected in Supabase have row-level security enabled.
- [x] Inspected public SECURITY DEFINER functions have a fixed search_path; none were executable by the anonymous role in the review performed.
- [x] Browser configuration uses a Supabase publishable key; server-side secrets are not part of the browser configuration.
- [x] Product-image storage is private and user-folder scoped. Buybook marketplace images are public by design when sellers publish them.
- [x] Service worker avoids caching Supabase REST, Auth, Storage and Functions responses.
- [x] The production Vercel project and primary domain were verified against the clean application commit before this documentation update.
- [x] Persistent invocation logging was disabled for the Cloudflare shop-front image-classification Worker, and query-string redaction was enabled. The changed settings were read back from the Cloudflare account.
- [ ] Verify the application still functions correctly through a live shop-front image-classification smoke test after the logging configuration change.
- [ ] Run the complete live Android acceptance test below after the latest production deployment.

## Live Android acceptance test

With two accounts, verify that each seller and buyer can access only the records and live location sessions they are authorised to see.

Use two separate ordinary seller accounts on two separate devices or isolated browser profiles. Do not use the administrator account for the seller workflow.

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

The live database contains historical identity-tier migrations that were superseded by later migrations. Do not reintroduce retired identity-tier gates. Do not run a blind production migration push while reviewing migration history. Inspect migration differences and pending changes before applying them to production.

## Legal and operator launch gate

### Completed operator and preparation work

The operator's legal identity, registered business name, proprietor and publication-authorised service address have been recorded. This does not replace the independent legal opinion and regulatory determinations listed below.

- [x] Record the registered business name as ADEYIMIKA INTEGRATED ENTERPRISES, a CAC-registered Business Name (not a limited company).
- [x] Record the proprietor and individual service operator as ADEYIMIKA AMUDA, matching the CAC proprietor details supplied.
- [x] Record the CAC business/service address as Along Riverside Hotel, Odo-Oba, Iwo, Iwo, Osun State, Nigeria. The proprietor authorised publication; the CAC record's `NULL` means no building number was assigned.
- [x] Add the supplied direct privacy/support email, sellbook.support@gmail.com, to the Privacy Notice and Terms of Use.
- [x] Proprietor confirmed that the privacy/support inbox is accessible, has been tested and is actively monitored.
- [x] Prepare a private Nigerian data-protection remediation pack containing the production data snapshot, preliminary role/lawful-basis matrix, provider-transfer register, draft NDPC classification request, DPO procurement terms, preliminary DPIA, ROPA framework and incident/request handling drafts.
- [x] Prepare a draft NDPC classification request and staged DPCO/legal counsel quotation request. These drafts have not been sent.
- [x] Inspect the shop-front image-classification Worker and disable persistent invocation logging; this does not itself constitute transfer approval or a completed DPIA.

### Mandatory professional and regulatory actions still open

- [ ] Obtain a written legal opinion from a Nigerian-qualified legal practitioner reviewing the live Privacy Notice, Terms, controller/processor roles, lawful bases, retention, browser storage, data-subject rights and Buybook marketplace processing.
- [ ] Obtain account-specific provider DPAs/terms, subprocessor and location details, retention/deletion commitments and a documented international transfer route under NDPA sections 41–43 and GAID Schedule 5.
- [ ] Obtain a written NDPC or NDPC-licensed DPCO determination of whether Sellbook/Buybook is a DCPMI, which category applies, who must register, the applicable fee and ongoing obligations. Do not guess the category or pay a guessed fee.
- [ ] Appoint a named individual DPO only after independently verifying that person's current NDPC CDPO credential; execute a service contract, verify independence and conflicts, publish the DPO contact and notify the Commission as required.
- [ ] Have the appointed accredited DPO validate the production facts, complete the GAID Schedule 4 statutory DPIA, determine and document residual risk, sign it and submit/file it with the NDPC. The private engineering draft is not a statutory DPIA.
- [ ] Implement a final data-retention schedule, Record of Processing Activities, DSAR log and tested workflow, breach response plan and staff/operator privacy training.
- [ ] Verify the live status of the conditional BytID/NIN verification pathway. Keep it unused until its necessity, lawful basis, provider contract, transfer route, retention and notice have been separately approved.
- [ ] Complete the two-account Android acceptance test and verify account deletion, local/offline data clearing, backups and marketplace workflows.

## Release decision

**Unrestricted public launch is not approved by this checklist.** Operator details and support-email verification are complete. Engineering/legal preparation is documented. The formal legal opinion, account-specific transfer safeguards, written NDPC classification/registration determination, named accredited DPO appointment, DPO-signed/filed statutory DPIA and live Android acceptance testing remain outstanding.

The NDPC GAID identifies mandatory DPIA circumstances that include e-commerce services, software enabling communications with data subjects and cross-border data transfers. The appointed DPO and Nigerian counsel must advise whether any affected processing should be paused or restricted before the statutory DPIA and transfer assessment are complete.

The available production account/session metrics do not prove the number of unique natural-person data subjects. DCPMI designation cannot be ruled out solely by the low early-stage account count because the Guidance Notice describes alternative designation criteria.
