# TechStore rollout

## Published batches

- Frontend base, catalog, product detail, authentication, cart, checkout, order detail, payment cancellation and order lookup: merged in PRs #1–#10.
- Information, policies, services, news and administration interface: PR #11, awaiting merge.
- Backend configuration, API, payment verification and automated regression checks: this branch, based on the frontend batch.

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

## Remaining integration work

- Merge the frontend batch before the backend batch.
- Run the suite against a dedicated MySQL test database and verify schema updates on a copy of existing data.
- Verify checkout in a browser, including return and cancel URLs. A browser redirect must not be treated as evidence of payment.
- Configure private payOS credentials and a public HTTPS webhook; verify live provider interaction in a controlled environment.
- Verify SMTP delivery with a dedicated test mailbox. Current automated tests never send email.
- Review account recovery, request limits, uploads and deployment settings before production use.
