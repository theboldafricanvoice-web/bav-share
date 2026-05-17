type TopupCatalogRuleInput = {
  countryCode?: string | null;
  currency?: string | null;
  retailPrice?: number | string | null;
};

function normalizeCode(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function normalizeNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function isTopupProductAllowedByCatalogRules(input: TopupCatalogRuleInput) {
  const countryCode = normalizeCode(input.countryCode);
  const currency = normalizeCode(input.currency);
  const retailPrice = normalizeNumber(input.retailPrice);

  if (countryCode === "SL" && currency === "SLE" && retailPrice != null) {
    return retailPrice >= 40;
  }

  return true;
}
