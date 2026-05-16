import { getSupabaseAdmin } from "@/lib/topup/auth";
import { getPaymentProviderWebhookAdapter } from "@/lib/topup/paymentProviders/registry";
import {
  handleNormalizedPaymentWebhook,
} from "@/lib/topup/payments";
import { jsonError } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text().catch(() => "");
    const rawPayload = rawBody ? JSON.parse(rawBody) : null;
    const adapter = getPaymentProviderWebhookAdapter(request.headers, rawPayload);

    if (!adapter) {
      return jsonError(
        "No payment webhook adapter matched this payload."
      );
    }

    const event = await adapter.verifyAndNormalize(request.headers, rawPayload, rawBody);

    if (!event) {
      return jsonError("Unable to verify or normalize this payment webhook.", 400);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await handleNormalizedPaymentWebhook({
      supabaseAdmin,
      event,
    });

    return NextResponse.json({
      ok: true,
      paymentProvider: event.paymentProvider,
      paymentReference: event.paymentReference,
      eventType: event.eventType,
      result: {
        alreadyVerified:
          "alreadyVerified" in result ? result.alreadyVerified : undefined,
        queuedForFulfillment:
          "queuedForFulfillment" in result
            ? result.queuedForFulfillment
            : undefined,
      },
    });
  } catch (error) {
    console.error("POST /api/topup/webhooks/payment error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to process payment webhook.",
      500
    );
  }
}
