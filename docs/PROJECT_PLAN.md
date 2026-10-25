# TechStore rollout

## Published batches

- Frontend base, catalog, product detail, authentication, cart, checkout, order detail, payment cancellation and order lookup: merged in PRs #1–#10.
- Information, policies, services, news and administration interface: PR #11, merged into main.
- Backend configuration, API, payment verification and automated regression checks: PR #12, merged into main; main checks passed.
- Contact validation, authenticated refund requests, paid-order cancellation review, readable lookup messages and escaped order rendering: PR #13, merged into main.
- Current follow-up: expiring one-time password-reset links, session invalidation after password changes and referential integrity for account/order deletion.

## Verification completed locally

- Frontend JavaScript syntax and local references across 31 HTML pages.
- Isolated SQLite API tests for authentication, authorization, cart, stock, order cancellation and public endpoints.
- Payment tests use a real SDK signature verifier and mocked provider responses; no money moves.
- Checkout return handling verifies payment through the authenticated API, with nine JavaScript regression scenarios.
- Payment creation rejects paid, cancelled or fulfilled orders, invalid methods and changes to an order's payment method; repeated COD requests reuse the pending payment.
- Order details display the API payment status consistently for COD, payOS and legacy MoMo, including pending and failed payments.
- Profile endpoints reject locked/deleted accounts, validate input before changing data and preserve contact details during password-only updates.
- Hidden products are excluded from the public catalog and rejected at cart/checkout; cart additions and updates respect available stock.
- Review submission validates ratings, product availability and account access; review text is escaped when rendered to prevent inserted HTML from running.
- Account creation validates lengths/passwords and has no default user password; the last active administrator cannot be demoted or locked.
- Product/inventory validation rejects invalid numeric data and deletion preserves products referenced by order history.
- Uploads decode and re-encode actual PNG/JPEG/WebP images, enforce limits and use unique names.
- GitHub Actions runs the API suite against an isolated MySQL 8.4 service as well as SQLite; reset guards reject application databases.
- Explicit file email mode never sends through SMTP; email transport is checked with mocks and all local HTML href/src targets are checked automatically.
- Refund requests require the authenticated owner and a confirmed online payment. A support request does not automatically cancel the order, restock inventory or mark funds refunded.
- Customer cancellation of a paid online order is blocked until support reviews the refund; unpaid online orders can still be cancelled normally.
- Order lookup and detail render customer/product text and image attributes as escaped content.
- Password recovery keeps the old password until the owner confirms a hashed, single-use, 15-minute reset token. Successful password changes revoke existing sessions.
- Account deletion preserves order history; unused account references are cleaned up. Deleted orders retain idempotency tombstones to prevent accidental recreation.

## Remaining integration work

- Verify schema updates on a copy of existing MySQL data; the CI service starts with a clean database.
- Verify checkout in a browser, including return and cancel URLs. A browser redirect must not be treated as evidence of payment.
- Configure private payOS credentials and a public HTTPS webhook; verify live provider interaction in a controlled environment.
- Verify SMTP delivery with a dedicated test mailbox. Current automated tests never send email.
- Review request limits across multiple workers, reset-token retention/cleanup, uploads and deployment settings before production use.
- Add a persistent refund-request queue, review status and provider refund reconciliation; the current form sends a support email only.
