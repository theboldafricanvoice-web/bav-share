import type { PaymentProviderWebhookAdapter } from "@/lib/topup/paymentProviders/base";
import type { NormalizedPaymentWebhookEvent } from "@/lib/topup/payments";
import { readString } from "@/lib/topup/utils";

type ManualWebhookBody = {
  paymentProvider?: string;
  paymentReference?: string;
  externalTransactionId?: string | null;
  eventType?: string;
  amount?: number | string | null;
  currency?: string | null;
};

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const manualPaymentProviderAdapter: PaymentProviderWebhookAdapter = {
  providerCode: "manual",
  supports(headers, rawPayload) {
    const headerProvider = readString(headers.get("x-bav-payment-provider"))?.toLowerCase();
    if (headerProvider === "manual") return true;

    if (!rawPayload || typeof rawPayload !== "object") return false;
    const payload = rawPayload as ManualWebhookBody;
    return readString(payload.paymentProvider)?.toLowerCase() === "manual";
  },
  async verifyAndNormalize(
    _headers,
    rawPayload
  ): Promise<NormalizedPaymentWebhookEvent | null> {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as ManualWebhookBody & Record<string, unknown>;
    const paymentReference = readString(payload.paymentReference);
    const externalTransactionId = readString(payload.externalTransactionId);
    const eventType = readString(payload.eventType)?.toLowerCase();
    const currency = readString(payload.currency)?.toUpperCase() ?? null;
    const amount = parseAmount(payload.amount);

    if (!paymentReference || !eventType) return null;

    if (
      eventType !== "payment_verified" &&
      eventType !== "payment_failed" &&
      eventType !== "payment_reversed"
    ) {
      return null;
    }

    return {
      paymentProvider: "manual",
      paymentReference,
      externalTransactionId,
      eventType,
      amount,
      currency,
      raw: payload,
    };
  },
};
