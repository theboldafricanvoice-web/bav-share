import { getSupabaseAdmin } from "@/lib/billsPay/auth";
import { getBillsPayPaymentWebhookAdapter } from "@/lib/billsPay/paymentWebhooks/registry";
import { handleNormalizedBillsPayPaymentWebhook } from "@/lib/billsPay/payments";
import { jsonError } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text().catch(() => "");
    const rawPayload = rawBody ? JSON.parse(rawBody) : null;
    const adapter = getBillsPayPaymentWebhookAdapter(request.headers, rawPayload);

    if (!adapter) {
      return jsonError("No bills-pay payment webhook adapter matched this payload.");
    }

    const event = await adapter.verifyAndNormalize(request.headers, rawPayload, rawBody);

    if (!event) {
      return jsonError("Unable to verify or normalize this bills-pay payment webhook.", 400);
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await handleNormalizedBillsPayPaymentWebhook({
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
      },
    });
  } catch (error) {
    console.error("POST /api/bills-pay/webhooks/payment error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to process bills-pay payment webhook.",
      500
    );
  }
}
