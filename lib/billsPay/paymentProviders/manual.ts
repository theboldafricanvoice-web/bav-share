import type {
  BillsPayPaymentProviderAdapter,
  BillsPayStartPaymentSessionInput,
  BillsPayStartPaymentSessionResult,
} from "@/lib/billsPay/paymentProviders/base";
import { buildBillsPayPaymentRef } from "@/lib/billsPay/utils";

export const manualBillsPayPaymentProviderAdapter: BillsPayPaymentProviderAdapter =
  {
    providerCode: "manual",
    getReadiness() {
      return {
        ready: true,
        issues: [],
      };
    },
    async startPaymentSession(
      input: BillsPayStartPaymentSessionInput
    ): Promise<BillsPayStartPaymentSessionResult> {
      const paymentReference = buildBillsPayPaymentRef("BAV-BPAY-DEMO");

      return {
        paymentProvider: "manual",
        mode: "manual_entry",
        paymentReference,
        checkoutUrl: null,
        externalTransactionId: null,
        message: `Demo payment session created for ${input.currency} ${input.amount}. Use the generated reference to continue sandbox testing.`,
        raw: {
          adapter: "manual",
          orderId: input.orderId,
          orderRef: input.orderRef,
          paymentReference,
        },
      };
    },
  };
