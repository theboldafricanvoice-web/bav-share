import type { NormalizedPaymentWebhookEvent } from "@/lib/topup/payments";

export interface PaymentProviderWebhookAdapter {
  providerCode: string;
  supports(headers: Headers, rawPayload: unknown): boolean;
  verifyAndNormalize(
    headers: Headers,
    rawPayload: unknown,
    rawBody?: string
  ): Promise<NormalizedPaymentWebhookEvent | null>;
}
