# BAV Bills Pay Payment Setup

`BAV Bills Pay` supports two backend-controlled payment modes:

- `manual`
  - sandbox/demo flow
  - safe for UI and backend testing without a live gateway
- `stripe`
  - real redirect-based checkout
  - backend still verifies payment through webhook before any fulfillment can continue

## Required Environment Variables

To enable the real Stripe path, configure:

- `BILLS_PAY_DEFAULT_PAYMENT_PROVIDER=stripe`
- `STRIPE_SECRET_KEY=...`
- `BILLS_PAY_STRIPE_SUCCESS_URL=https://your-app-or-web-return-url`
- `BILLS_PAY_STRIPE_CANCEL_URL=https://your-app-or-cancel-url`
- `BILLS_PAY_STRIPE_WEBHOOK_SECRET=...`
  - required for webhook verification after checkout

For BAV Top-Up, also configure:

- `TOPUP_DEFAULT_PAYMENT_PROVIDER=stripe`
- `TOPUP_STRIPE_SUCCESS_URL=https://your-app-or-web-return-url`
- `TOPUP_STRIPE_CANCEL_URL=https://your-app-or-cancel-url`
- `TOPUP_STRIPE_WEBHOOK_SECRET=...`
  - required for webhook verification after checkout

## Important Notes

- The mobile app never talks to Stripe directly with secrets.
- The mobile app only requests a payment session from the BAV backend.
- The backend creates the Stripe Checkout session and verifies the webhook before updating the order to a paid state.
- If any required Stripe env var is missing, `POST /api/bills-pay/orders/[id]/start-payment` returns `503` with the missing configuration keys so the issue is obvious during deployment.

## Recommended Rollout

1. Keep `BILLS_PAY_DEFAULT_PAYMENT_PROVIDER=manual` in lower-risk environments while testing the bills-pay app flow.
2. Configure all Stripe env vars in the production backend.
3. Change `BILLS_PAY_DEFAULT_PAYMENT_PROVIDER=stripe`.
4. Test a real redirect checkout and confirm the webhook moves the order forward only after backend verification.
