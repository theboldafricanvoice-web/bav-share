import type { TopupPaymentProviderAdapter } from "@/lib/topup/paymentSessions/base";
import { manualTopupPaymentProviderAdapter } from "@/lib/topup/paymentSessions/manual";
import { stripeTopupPaymentProviderAdapter } from "@/lib/topup/paymentSessions/stripe";

const TOPUP_PAYMENT_PROVIDER_ADAPTERS: TopupPaymentProviderAdapter[] = [
  manualTopupPaymentProviderAdapter,
  stripeTopupPaymentProviderAdapter,
];

export function getTopupPaymentProviderAdapter(providerCode: string) {
  return (
    TOPUP_PAYMENT_PROVIDER_ADAPTERS.find(
      (adapter) => adapter.providerCode === providerCode
    ) ?? null
  );
}

export function getTopupPaymentProviderReadiness(providerCode: string) {
  const adapter = getTopupPaymentProviderAdapter(providerCode);
  if (!adapter) {
    return {
      ready: false,
      issues: ["provider_not_found"],
    };
  }

  return (
    adapter.getReadiness?.() ?? {
      ready: true,
      issues: [],
    }
  );
}

export function getDefaultTopupPaymentProviderCode() {
  const configured = process.env.TOPUP_DEFAULT_PAYMENT_PROVIDER?.trim().toLowerCase();
  return configured || "manual";
}
