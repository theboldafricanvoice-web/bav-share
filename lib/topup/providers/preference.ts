const TOPUP_PROVIDER_PRIORITY = ["reloadly", "dingconnect", "manual"] as const;

export function getTopupProviderPriority(providerCode: string | null | undefined) {
  const normalized = providerCode?.trim().toLowerCase() ?? "";
  const index = TOPUP_PROVIDER_PRIORITY.indexOf(
    normalized as (typeof TOPUP_PROVIDER_PRIORITY)[number]
  );
  return index === -1 ? TOPUP_PROVIDER_PRIORITY.length : index;
}

export function compareTopupProviderPriority(
  left: string | null | undefined,
  right: string | null | undefined
) {
  return getTopupProviderPriority(left) - getTopupProviderPriority(right);
}

export function normalizeTopupComparableText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
