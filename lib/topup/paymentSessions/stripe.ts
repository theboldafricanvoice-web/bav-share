import type {
  TopupPaymentProviderAdapter,
  TopupStartPaymentSessionInput,
  TopupStartPaymentSessionResult,
} from "@/lib/topup/paymentSessions/base";
import { buildTopupPaymentRef } from "@/lib/topup/utils";

export const stripeTopupPaymentProviderAdapter: TopupPaymentProviderAdapter = {
  providerCode: "stripe",
  getReadiness() {
    const issues: string[] = [];

    if (!process.env.STRIPE_SECRET_KEY?.trim()) {
      issues.push("STRIPE_SECRET_KEY");
    }

    if (!process.env.TOPUP_STRIPE_SUCCESS_URL?.trim()) {
      issues.push("TOPUP_STRIPE_SUCCESS_URL");
    }

    if (!process.env.TOPUP_STRIPE_CANCEL_URL?.trim()) {
      issues.push("TOPUP_STRIPE_CANCEL_URL");
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
      issues.push("TOPUP_STRIPE_WEBHOOK_SECRET");
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  },
  async startPaymentSession(
    input: TopupStartPaymentSessionInput
  ): Promise<TopupStartPaymentSessionResult> {
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is missing for top-up payment initialization.");
    }

    const successUrl = process.env.TOPUP_STRIPE_SUCCESS_URL?.trim();
    const cancelUrl = process.env.TOPUP_STRIPE_CANCEL_URL?.trim();

    if (!successUrl || !cancelUrl) {
      throw new Error(
        "TOPUP_STRIPE_SUCCESS_URL or TOPUP_STRIPE_CANCEL_URL is missing for top-up payment initialization."
      );
    }

    const paymentReference = buildTopupPaymentRef("BAV-TPAY-ST");
    const amountMinor = Math.round(Number(input.amount) * 100);

    const body = new URLSearchParams({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][product_data][name]": `BAV Top-Up ${input.orderRef}`,
      "line_items[0][price_data][product_data][description]": `Top-up order ${input.orderRef}`,
      "line_items[0][price_data][unit_amount]": String(amountMinor),
      "line_items[0][quantity]": "1",
      client_reference_id: input.orderId,
      "metadata[source]": "bav-topup",
      "metadata[orderId]": input.orderId,
      "metadata[orderRef]": input.orderRef,
      "metadata[paymentReference]": paymentReference,
    });

    if (input.email?.trim()) {
      body.set("customer_email", input.email.trim());
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          id?: string;
          url?: string | null;
          payment_intent?: string | null;
          error?: { message?: string };
        }
      | null;

    if (!response.ok || !payload?.id || !payload.url) {
      throw new Error(
        payload?.error?.message || "Unable to initialize Stripe top-up checkout."
      );
    }

    return {
      paymentProvider: "stripe",
      mode: "redirect_url",
      paymentReference,
      checkoutUrl: payload.url,
      externalTransactionId:
        typeof payload.payment_intent === "string" ? payload.payment_intent : null,
      message: "Secure payment session created with Stripe.",
      raw: (payload ?? {}) as Record<string, unknown>,
    };
  },
};
