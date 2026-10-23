# MLM Backend

The MLM API is mounted at `/api/mlm`. Existing user accounts authenticate with the same JWT cookie or bearer token as the rest of the API.

## Package And Calculation Rules

| Package | MRP | Discounted price | BV | Matching bonus | Daily matching cap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter | Rs 2,400 | Rs 1,920 | 1,199 | Rs 179 | Rs 1,000 |
| Growth | Rs 2,999 | Rs 2,400 | 1,799 | Rs 269 | Rs 2,000 |
| Elite | Rs 4,999 | Rs 4,000 | 2,999 | Rs 449 | Rs 3,000 |

The first binary payout consumes 2 left and 1 right placement events, or 1 left and 2 right events. Later payouts consume 1 event from each side. Unmatched events carry forward. Each match pays the fixed matching bonus on the member's package; the daily processor pays only the remaining cap and records the rest as flushed.

Fund allocations use floor rounding independently for each percentage: product cost 32%, profit 30%, matching 15%, referral 5%, royalty 5%, franchise 8%, and reward income 5%. The unallocated rounding remainder is reported, not assigned. Referral allocation is credited to the active sponsor when the new member is activated. Royalty, franchise, and reward allocations are calculated but are not credited because recipient qualification rules have not been provided.

## API

- `GET /api/mlm/packages` returns package terms.
- `POST /api/mlm/register` creates the ecommerce user and pending MLM member atomically, and returns an access token. The authenticated panel uses this for signup.
- `GET /api/mlm/referrals/:memberCode/placements` returns the sponsor and currently available placement slots.
- `POST /api/mlm/enroll` (authenticated) creates a pending enrollment. Body: `{ "packageId": "starter", "sponsorCode": "AYV-...", "placementCode": "AYV-...", "placementLeg": "left" }`. Sponsor and placement fields are optional for a root member.
- `GET /api/mlm/me` returns the authenticated account's MLM member profile and wallet totals.
- `GET /api/mlm/me/network` returns its active binary placement downline.
- `GET /api/mlm/me/volume?days=30` returns daily placement BV for a 7-, 30-, or 90-day dashboard chart.
- `GET /api/mlm/me/payment/config` reports whether package checkout is configured and returns only the public Razorpay key ID.
- `POST /api/mlm/me/payment/order` creates a server-priced Razorpay package order for the authenticated member.
- `POST /api/mlm/me/payment/verify` verifies the HMAC and captured payment, then queues it for administrator review. It does not activate the member.
- `GET /api/mlm/me/payment/status` returns the latest payment review/refund status.
- `GET /api/mlm/me/kyc/config` reports whether encrypted KYC storage is configured.
- `GET /api/mlm/me/kyc` returns only the authenticated member's KYC status and masked PAN suffix.
- `POST /api/mlm/me/kyc` accepts multipart fields `legalName`, `dateOfBirth`, `panNumber`, `identityDocumentType`, `addressLine1`, `addressLine2`, `city`, `state`, `pincode`, `panDocument`, and `identityDocument`.
- `GET /api/mlm/me/commissions?page=1&limit=25` returns paginated commission history.
- `POST /api/mlm/me/withdrawals` requests a withdrawal. Body: `{ "amount": 500, "payoutDetails": { "method": "upi", "upiId": "name@bank" } }`. Bank details use `method: "bank"`, `accountName`, `accountNumber`, and `ifsc`.
- `GET /api/mlm/me/withdrawals?limit=50` returns the member's withdrawal history.
- `GET /api/mlm/admin/members?status=pending` (admin) lists enrollments for review.
- `POST /api/mlm/admin/members/:memberId/activate` (admin) activates a pending enrollment. Body: `{ "paymentReference": "..." }`.
- `GET /api/mlm/admin/summary` and `GET /api/mlm/admin/payout-runs` (admin) return operational summaries.
- `GET /api/mlm/admin/package-payments?status=verified` (admin) lists captured payments awaiting approval.
- `PUT /api/mlm/admin/package-payments/:paymentId/review` (admin) approves and activates with `{ "decision": "approved" }`, or rejects and initiates a full refund with `{ "decision": "rejected", "rejectionReason": "..." }`.
- `GET /api/mlm/admin/withdrawals?status=pending` (admin) lists withdrawal requests.
- `GET /api/mlm/admin/kyc?status=submitted` (admin) lists KYC cases; `status` can also be `under_review`, `approved`, or `rejected`.
- `GET /api/mlm/admin/kyc/:kycId/documents/:type` (admin) downloads one private `pan` or `identity` document.
- `PUT /api/mlm/admin/kyc/:kycId/review` (admin) approves with `{ "decision": "approved" }` or rejects with `{ "decision": "rejected", "rejectionReason": "..." }`.
- `PUT /api/mlm/admin/withdrawals/:withdrawalId` (admin) marks a request paid or rejected. Paid body: `{ "decision": "paid", "paymentReference": "..." }`. Rejected body: `{ "decision": "rejected", "rejectionReason": "..." }`.
- `POST /api/mlm/admin/payouts/run` (admin) retries a closed date. Body: `{ "dateKey": "YYYY-MM-DD" }`.

Package activation runs automatically only after server-side Razorpay signature, order, amount, currency, and captured-status validation. Admin activation remains available for manually verified payment references. Public user registration cannot grant admin access.

## Operations

The server initializes MLM unique indexes after connecting to MongoDB. KYC and captured package payments enter separate admin review queues; only admin payment approval activates the member, while admin KYC approval is required before withdrawals. Rejected captured payments initiate a full Razorpay refund. Set `KYC_ENCRYPTION_KEY` to a stable 32-byte hex secret (generate with `openssl rand -hex 32`) before collecting KYC. PAN values and document bytes are encrypted with AES-256-GCM in MongoDB; rotating this key without an explicit re-encryption migration makes existing KYC unreadable. Government ID images should use masked Aadhaar where applicable. KYC documents are never stored in public uploads or returned from member APIs. Package checkout requires `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the backend environment; the panel retrieves only the public key ID from the API. The payout cron runs automatically in production; set `MLM_PAYOUT_CRON_ENABLED=true` to enable it elsewhere. It polls for payout work every ten minutes in Asia/Kolkata, processes closed India dates, and catches up missed dates on startup. Per-member activation, payout, withdrawal, and refund-on-rejection writes use MongoDB transactions, so the configured MongoDB deployment must support transactions (for local MongoDB, use a replica set). Set `MONGO_URI` and `JWT_SECRET` before starting the backend.

The backend allows the configured storefront/member portal origins for credentialed API requests. Add deployed origins, with no trailing slash, to the comma-separated `CORS_ALLOWED_ORIGINS` environment variable. Configure `VITE_API_URL` in the storefront and member portal deployments to the backend API base URL (ending in `/api`), and configure the storefront's `VITE_MLM_PANEL_URL` to the deployed member portal URL.

Run the calculation tests with `npm run test:mlm` from `Ayurva_backend`.
## Partner application (public registration)

`POST /api/mlm/register` accepts an `applicantProfile` (category, council registration no., organisation, state, city, PIN, `undertakingAccepted`), a `payoutAccount` (PAN, account holder name, account number + confirmation, IFSC) and a `phoneVerificationToken`. When `applicantProfile` is present the request is treated as a partner application:

- **Phone OTP** — enabled when `Twilio_ACCOUNT_SID`, `Twilio_AUTH_TOKEN` and `TWILIO_VERIFY_SERVICE_SID` are set. The panel calls `POST /mlm/register/otp/send` and `POST /mlm/register/otp/verify` (rate limited); verification returns a 20-minute signed token bound to the phone number, which registration then requires.
- **PAN and bank account** — enabled when `KYC_ENCRYPTION_KEY` is set. PAN and account number are AES-256-GCM encrypted in `MlmPayoutAccount` (never returned by APIs; only last four digits are stored in clear). A duplicate PAN is rejected. `holderNameMatchesLegalName` flags a name mismatch for admin review. Without the key, the panel hides these fields and the details are collected later in KYC.
- `GET /api/mlm/register/config` reports which of these features are active (`phoneOtpEnabled`, `payoutDetailsEnabled`).

Registrations that omit `applicantProfile` (such as a member adding a downline entry from the dashboard) keep the previous behaviour and skip OTP and payout details.
