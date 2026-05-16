import type {
  TopupPaymentProviderAdapter,
  TopupStartPaymentSessionInput,
  TopupStartPaymentSessionResult,
} from "@/lib/topup/paymentSessions/base";
import { buildTopupPaymentRef } from "@/lib/topup/utils";

export const manualTopupPaymentProviderAdapter: TopupPaymentProviderAdapter = {
  providerCode: "manual",
  getReadiness() {
    return {
      ready: true,
      issues: [],
    };
  },
  async startPaymentSession(
    input: TopupStartPaymentSessionInput
  ): Promise<TopupStartPaymentSessionResult> {
    const paymentReference = buildTopupPaymentRef("BAV-TPAY-DEMO");

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
