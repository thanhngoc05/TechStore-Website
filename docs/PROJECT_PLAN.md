# TechStore rollout

## Published batches

- Frontend base, catalog, product detail, authentication, cart, checkout, order detail, payment cancellation and order lookup: merged in PRs #1–#10.
- Information, policies, services, news and administration interface: PR #11, merged into main.
- Backend configuration, API, payment verification and automated regression checks: PR #12, merged into main; main checks passed.
- Contact validation, authenticated refund requests, paid-order cancellation review, readable lookup messages and escaped order rendering: PR #13, merged into main.
- Expiring password-reset links, session invalidation and deletion integrity: PR #14, merged into main.
- Durable refund request queue, review/audit workflow, customer tracking and reset-token retention tooling: PR #15, merged into main.
- Shared request limits, delivery retries, readiness/schema preflight and a validated WSGI entrypoint: PR #16, merged into main.
- Public news privacy, checkout retry safety, editor/order validation, private warranty lookup, explicit trusted proxy settings and Chromium smoke tests: PR #17, merged into main.
- Complete COD purchase/cancellation browser verification: published directly to main in commit 7203db8.

## Verification completed locally

- Frontend JavaScript syntax and local references across 34 HTML pages.
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
- Refund requests are stored before email notification and deduplicated by order. Masked tracking is private to the owner.
- Admin review uses status transitions, mandatory final feedback, optimistic revisions and persistent audit history. Review does not execute financial or inventory actions.
- Customer tracking is available from profile, the request form and order details; all customer/staff content is rendered as text.
- The cleanup-reset-tokens CLI previews expired-token retention cleanup unless --apply is explicitly supplied; it does not schedule a job.
- Authentication/support limits use atomic database counters, with expiration cleanup and no trust in arbitrary forwarded IP headers.
- Request-size bounds, private response caching rules and readiness checks have regression coverage.
- Notification attempts distinguish actual delivery, simulation and failure; authorized retries preserve draft feedback and business state.
- Schema preflight detects missing tables/columns with automatic initialization disabled. Waitress settings validate before starting and the entrypoint disables debug mode.

## Remaining integration work

- Verify schema updates on a copy of existing MySQL data; the CI service starts with a clean database.
- Chromium smoke tests cover catalog navigation, registration/login, refund permissions/tracking, a forged paid return, and complete COD checkout/cancellation against a disposable backend. Verify actual provider payment/return flows in a controlled environment.
- Configure private payOS credentials and a public HTTPS webhook; verify live provider interaction in a controlled environment.
- Verify SMTP delivery with a dedicated test mailbox. Current automated tests never send email.
- Load-test shared request limits under multiple workers and verify trusted proxy, retention policy and deployment settings before production use.
- Implement and verify provider-side refund execution/reconciliation separately. A resolved support request is not evidence of a financial refund.
- Define retention/access policy for stored refund bank details and an operational process for manual notification retries.

## Storefront validation follow-up

- Public news rejects private status filters and exposes scheduled posts only after their scheduled time. The editor accepts HTML datetime-local values, validates status/date combinations and preserves omitted fields.
- Checkout preserves the same idempotency key after conflicts, rate limits and connection errors. The browser never retries a conflicting request with a fresh key automatically.
- Orders reject malformed customer fields, item lists, methods and numeric overflow before changing stock. Banner/news image paths allow HTTP(S) or local files and reject unsafe schemes.
- Warranty lookup requires both a phone number and a matching code/serial, limits attempts and masks public results. Internal notes and customer contact details stay in the administration interface.
- Warranty editing validates dates, statuses, field sizes and history; malformed legacy history cannot break the list endpoint.
- Waitress trusts forwarded client/protocol headers only from an explicitly configured proxy IP. Middleware tests cover both trusted and spoofed remote peers.
- Browser tests run in GitHub Actions with Chromium, use a separate SQLite database under instance/browser-tests and never reuse a running application server. They do not contact SMTP or payOS.
- The COD browser scenario fills shipping fields, verifies one order with the expected customer/items/total and checks cancellation through the order-detail page. Address options use an isolated fixture rather than the external location service.
- Cart and checkout rendering escapes product, image and customer fields in both provisional and server-confirmed summaries.
- Shipping cannot advance while locations are loading, with incomplete district/ward selections, a missing street address or an invalid phone. Manual address entry remains available when location loading fails.
- Partial-cart browser coverage changes the selected quantity, checks the exact order payload/total and confirms that the unselected item remains in the cart after payment setup.
