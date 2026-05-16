import type { PaymentProviderWebhookAdapter } from "@/lib/topup/paymentProviders/base";
import { manualPaymentProviderAdapter } from "@/lib/topup/paymentProviders/manual";
import { stripeTopupPaymentWebhookAdapter } from "@/lib/topup/paymentProviders/stripe";

const PAYMENT_PROVIDER_ADAPTERS: PaymentProviderWebhookAdapter[] = [
  manualPaymentProviderAdapter,
  stripeTopupPaymentWebhookAdapter,
];

export function getPaymentProviderWebhookAdapter(
  headers: Headers,
  rawPayload: unknown
) {
  return (
    PAYMENT_PROVIDER_ADAPTERS.find((adapter) =>
      adapter.supports(headers, rawPayload)
    ) ?? null
  );
}
