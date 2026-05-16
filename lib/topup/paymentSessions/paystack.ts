import type {
  TopupPaymentProviderAdapter,
  TopupStartPaymentSessionInput,
  TopupStartPaymentSessionResult,
} from "@/lib/topup/paymentSessions/base";
import { buildTopupPaymentRef } from "@/lib/topup/utils";

export const paystackTopupPaymentProviderAdapter: TopupPaymentProviderAdapter = {
  providerCode: "paystack",
  getReadiness() {
    const issues: string[] = [];

    if (!process.env.PAYSTACK_SECRET_KEY?.trim()) {
      issues.push("PAYSTACK_SECRET_KEY");
    }

    if (!process.env.TOPUP_PAYSTACK_CALLBACK_URL?.trim()) {
      issues.push("TOPUP_PAYSTACK_CALLBACK_URL");
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  },
  async startPaymentSession(
    input: TopupStartPaymentSessionInput
  ): Promise<TopupStartPaymentSessionResult> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is missing for top-up payment initialization.");
    }

    const paymentReference = buildTopupPaymentRef("BAV-TPAY-PS");
    const callbackUrl = process.env.TOPUP_PAYSTACK_CALLBACK_URL?.trim();
    if (!callbackUrl) {
      throw new Error("TOPUP_PAYSTACK_CALLBACK_URL is missing for top-up payment initialization.");
    }

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        email: input.email ?? "payments@bavnetwork.com",
        amount: Math.round(Number(input.amount) * 100),
        currency: input.currency,
        reference: paymentReference,
        callback_url: callbackUrl,
        metadata: {
          source: "bav-topup",
          orderId: input.orderId,
          orderRef: input.orderRef,
          paymentReference,
        },
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          status?: boolean;
          message?: string;
          data?: {
            authorization_url?: string;
            reference?: string;
          };
        }
      | null;

    if (!response.ok || !payload?.status || !payload.data?.authorization_url) {
      throw new Error(
        payload?.message || "Unable to initialize Paystack top-up transaction."
      );
    }

    return {
      paymentProvider: "paystack",
      mode: "redirect_url",
      paymentReference: readStringOrFallback(payload.data.reference, paymentReference),
      checkoutUrl: payload.data.authorization_url,
      externalTransactionId: null,
      message: "Secure payment session created with Paystack.",
      raw: (payload ?? {}) as Record<string, unknown>,
    };
  },
};

function readStringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
