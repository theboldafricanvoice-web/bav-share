import crypto from "crypto";
import type { PaymentProviderWebhookAdapter } from "@/lib/topup/paymentProviders/base";
import type { NormalizedPaymentWebhookEvent } from "@/lib/topup/payments";
import { readString } from "@/lib/topup/utils";

type StripeWebhookBody = {
  type?: string;
  data?: {
    object?: {
      id?: string;
      payment_intent?: string | null;
      amount_total?: number | null;
      currency?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
  } | null;
};

function timingSafeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(signatureHeader: string, rawBody: string, secret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe signature header.");
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return signatures.some((signature) => timingSafeEqualHex(expected, signature));
}

export const stripeTopupPaymentWebhookAdapter: PaymentProviderWebhookAdapter = {
  providerCode: "stripe",
  supports(headers, rawPayload) {
    if (!headers.get("stripe-signature")) return false;
    if (!rawPayload || typeof rawPayload !== "object") return false;
    const payload = rawPayload as StripeWebhookBody;
    return Boolean(payload.type && payload.data?.object);
  },
  async verifyAndNormalize(
    headers,
    rawPayload,
    rawBody
  ): Promise<NormalizedPaymentWebhookEvent | null> {
    if (!rawPayload || typeof rawPayload !== "object" || !rawBody) return null;

    const webhookSecret = process.env.TOPUP_STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      throw new Error(
        "TOPUP_STRIPE_WEBHOOK_SECRET is missing for top-up webhook verification."
      );
    }

    const signature = headers.get("stripe-signature")?.trim();
    if (!signature) return null;

    if (!verifyStripeSignature(signature, rawBody, webhookSecret)) {
      throw new Error("Invalid Stripe webhook signature.");
    }

    const payload = rawPayload as StripeWebhookBody;
    const eventType = readString(payload.type)?.toLowerCase();
    const object = payload.data?.object ?? null;
    const metadata = object?.metadata ?? null;
    const paymentReference =
      metadata && typeof metadata === "object"
        ? readString((metadata as Record<string, unknown>).paymentReference)
        : null;

    if (!paymentReference || !eventType) return null;

    let normalizedEventType: NormalizedPaymentWebhookEvent["eventType"] | null = null;

    if (eventType === "checkout.session.completed") {
      normalizedEventType = "payment_verified";
    } else if (eventType === "checkout.session.expired") {
      normalizedEventType = "payment_failed";
    } else if (eventType === "charge.refunded") {
      normalizedEventType = "payment_reversed";
    }

    if (!normalizedEventType) return null;

    return {
      paymentProvider: "stripe",
      paymentReference,
      externalTransactionId:
        readString(object?.payment_intent) ?? readString(object?.id) ?? null,
      eventType: normalizedEventType,
      amount:
        typeof object?.amount_total === "number"
          ? Number(object.amount_total) / 100
          : null,
      currency: readString(object?.currency)?.toUpperCase() ?? null,
      raw: payload as Record<string, unknown>,
    };
  },
};
