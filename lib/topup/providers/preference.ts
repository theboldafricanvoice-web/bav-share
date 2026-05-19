const TOPUP_PROVIDER_PRIORITY = ["dingconnect", "reloadly", "manual"] as const;
const TOPUP_NETWORK_NOISE_TOKENS = [
  "sierraleone",
  "sierra",
  "leone",
  "sl",
  "nigeria",
  "ng",
  "liberia",
  "lr",
  "guinea",
  "gn",
  "gambia",
  "gm",
  "ghana",
  "gh",
  "kenya",
  "ke",
  "mobile",
  "network",
] as const;

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
  const collapsed = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

  if (!collapsed) return "";

  let normalized = collapsed;
  for (const token of TOPUP_NETWORK_NOISE_TOKENS) {
    normalized = normalized.replaceAll(token, "");
  }

  return normalized || collapsed;
}
