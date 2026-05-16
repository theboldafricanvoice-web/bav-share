import type { NormalizedBillsPayPaymentWebhookEvent } from "@/lib/billsPay/payments";

export interface BillsPayPaymentWebhookAdapter {
  providerCode: string;
  supports(headers: Headers, rawPayload: unknown): boolean;
  verifyAndNormalize(
    headers: Headers,
    rawPayload: unknown,
    rawBody?: string
  ): Promise<NormalizedBillsPayPaymentWebhookEvent | null>;
}
