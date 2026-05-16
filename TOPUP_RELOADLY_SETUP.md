# BAV Top-Up Reloadly Setup

Use this when moving BAV Top-Up from the manual demo provider to real fulfillment.

## Required backend env vars

```env
TOPUP_RELOADLY_CLIENT_ID=your_reloadly_client_id
TOPUP_RELOADLY_CLIENT_SECRET=your_reloadly_client_secret
TOPUP_RELOADLY_ENVIRONMENT=sandbox
TOPUP_INTERNAL_API_KEY=your_internal_sync_and_fulfillment_key
```

Notes:

- Set `TOPUP_RELOADLY_ENVIRONMENT=live` when you are ready for production fulfillment.
- Reloadly uses separate live and sandbox credentials.
- Stripe and Reloadly are separate concerns:
  - Stripe collects payment from the BAV customer
  - Reloadly delivers airtime/data to the recipient

## Sync the catalog

The mobile app reads from `data_topup_networks` and `data_topup_products`, so the catalog must be synced before orders can use real provider products.

Internal route:

`POST /api/topup/internal/sync-catalog`

Headers:

```txt
x-topup-internal-key: <TOPUP_INTERNAL_API_KEY>
```

Example body:

```json
{
  "providerCode": "reloadly",
  "countryCodes": ["SL"],
  "activate": false
}
```

Recommended first run:

- run with `"activate": false` to import the provider catalog without exposing it in the live app yet
- review the imported `reloadly` rows in Supabase
- run again with `"activate": true` when ready to switch the visible catalog

## Fulfillment behavior

- Once a top-up order is paid and verified, the backend sends the order to Reloadly
- Fulfillment status is reconciled using Reloadly transaction status checks
- The current implementation does not depend on provider webhooks
