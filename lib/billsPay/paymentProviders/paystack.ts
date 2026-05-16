import type {
  BillsPayPaymentProviderAdapter,
  BillsPayStartPaymentSessionInput,
  BillsPayStartPaymentSessionResult,
} from "@/lib/billsPay/paymentProviders/base";
import { buildBillsPayPaymentRef } from "@/lib/billsPay/utils";

export const paystackBillsPayPaymentProviderAdapter: BillsPayPaymentProviderAdapter = {
  providerCode: "paystack",
  getReadiness() {
    const issues: string[] = [];

    if (!process.env.PAYSTACK_SECRET_KEY?.trim()) {
      issues.push("PAYSTACK_SECRET_KEY");
    }

    if (!process.env.BILLS_PAY_PAYSTACK_CALLBACK_URL?.trim()) {
      issues.push("BILLS_PAY_PAYSTACK_CALLBACK_URL");
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  },
  async startPaymentSession(
    input: BillsPayStartPaymentSessionInput
  ): Promise<BillsPayStartPaymentSessionResult> {
    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is missing for bills-pay payment initialization.");
    }

    const paymentReference = buildBillsPayPaymentRef("BAV-BPAY-PS");
    const callbackUrl = process.env.BILLS_PAY_PAYSTACK_CALLBACK_URL?.trim();
    if (!callbackUrl) {
      throw new Error(
        "BILLS_PAY_PAYSTACK_CALLBACK_URL is missing for bills-pay payment initialization."
      );
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
          source: "bav-bills-pay",
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
        payload?.message || "Unable to initialize Paystack bills-pay transaction."
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
