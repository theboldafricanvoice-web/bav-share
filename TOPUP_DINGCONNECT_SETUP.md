# BAV Top-Up DingConnect Setup

Use this when moving BAV Top-Up from the manual demo provider to DingConnect.

## Required backend env vars

```env
TOPUP_DINGCONNECT_CLIENT_ID=your_dingconnect_client_id
TOPUP_DINGCONNECT_CLIENT_SECRET=your_dingconnect_client_secret
TOPUP_DINGCONNECT_BASE_URL=https://api.dingconnect.com
TOPUP_INTERNAL_API_KEY=your_internal_sync_and_fulfillment_key
```

Notes:

- This integration uses DingConnect OAuth client credentials.
- Stripe and DingConnect are separate:
  - Stripe collects payment from the BAV customer
  - DingConnect delivers airtime/data to the recipient

## Sync the catalog

Internal route:

`POST /api/topup/internal/sync-catalog`

Headers:

```txt
x-topup-internal-key: <TOPUP_INTERNAL_API_KEY>
```

Example body:

```json
{
  "providerCode": "dingconnect",
  "countryCodes": ["SL"],
  "activate": false
}
```

Recommended first run:

- run with `"activate": false` first
- review the imported `dingconnect` rows in Supabase
- run again with `"activate": true` when ready to expose the real catalog

## Current implementation notes

- fixed-denomination products are imported automatically
- variable-range products are skipped for now
- fulfillment status is reconciled using DingConnect transfer record lookups
- provider webhooks are not yet required for the first live rollout path
