import crypto from "crypto";
import type { PaymentProviderWebhookAdapter } from "@/lib/topup/paymentProviders/base";
import type { NormalizedPaymentWebhookEvent } from "@/lib/topup/payments";
import { readString } from "@/lib/topup/utils";

type PaystackWebhookBody = {
  event?: string;
  data?: {
    status?: string;
    reference?: string;
    id?: number | string;
    amount?: number;
    currency?: string;
    metadata?: Record<string, unknown> | null;
  } | null;
};

function timingSafeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export const paystackTopupPaymentWebhookAdapter: PaymentProviderWebhookAdapter = {
  providerCode: "paystack",
  supports(headers, rawPayload) {
    if (!headers.get("x-paystack-signature")) return false;
    if (!rawPayload || typeof rawPayload !== "object") return false;
    const payload = rawPayload as PaystackWebhookBody;
    return Boolean(payload.event && payload.data);
  },
  async verifyAndNormalize(
    headers,
    rawPayload
  ): Promise<NormalizedPaymentWebhookEvent | null> {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is missing for top-up webhook verification.");
    }

    const signature = headers.get("x-paystack-signature")?.trim();
    if (!signature) return null;

    const rawString = JSON.stringify(rawPayload);
    const expected = crypto
      .createHmac("sha512", secretKey)
      .update(rawString)
      .digest("hex");

    if (!timingSafeEqualHex(expected, signature)) {
      throw new Error("Invalid Paystack webhook signature.");
    }

    const payload = rawPayload as PaystackWebhookBody;
    const eventType = readString(payload.event)?.toLowerCase();
    const status = readString(payload.data?.status)?.toLowerCase();
    const metadata = payload.data?.metadata ?? null;
    const metadataReference =
      metadata && typeof metadata === "object"
        ? readString((metadata as Record<string, unknown>).paymentReference)
        : null;
    const paymentReference =
      metadataReference ?? readString(payload.data?.reference) ?? null;

    if (!paymentReference || !eventType) return null;

    let normalizedEventType: NormalizedPaymentWebhookEvent["eventType"] | null = null;

    if (eventType === "charge.success" && status === "success") {
      normalizedEventType = "payment_verified";
    } else if (eventType === "charge.failed" || status === "failed") {
      normalizedEventType = "payment_failed";
    } else if (eventType === "charge.reversed") {
      normalizedEventType = "payment_reversed";
    }

    if (!normalizedEventType) return null;

    return {
      paymentProvider: "paystack",
      paymentReference,
      externalTransactionId:
        payload.data?.id != null ? String(payload.data.id) : null,
      eventType: normalizedEventType,
      amount:
        typeof payload.data?.amount === "number"
          ? Number(payload.data.amount) / 100
          : null,
      currency: readString(payload.data?.currency)?.toUpperCase() ?? null,
      raw: payload as Record<string, unknown>,
    };
  },
};
