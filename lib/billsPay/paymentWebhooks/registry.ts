import type { BillsPayPaymentWebhookAdapter } from "@/lib/billsPay/paymentWebhooks/base";
import { manualBillsPayPaymentWebhookAdapter } from "@/lib/billsPay/paymentWebhooks/manual";
import { stripeBillsPayPaymentWebhookAdapter } from "@/lib/billsPay/paymentWebhooks/stripe";

const BILLS_PAY_PAYMENT_WEBHOOK_ADAPTERS: BillsPayPaymentWebhookAdapter[] = [
  manualBillsPayPaymentWebhookAdapter,
  stripeBillsPayPaymentWebhookAdapter,
];

export function getBillsPayPaymentWebhookAdapter(
  headers: Headers,
  rawPayload: unknown
) {
  return (
    BILLS_PAY_PAYMENT_WEBHOOK_ADAPTERS.find((adapter) =>
      adapter.supports(headers, rawPayload)
    ) ?? null
  );
}
