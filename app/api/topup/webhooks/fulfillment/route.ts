import { getSupabaseAdmin } from "@/lib/topup/auth";
import { applyTopupFulfillmentWebhook } from "@/lib/topup/fulfillment";
import {
  getTopupAggregatorAdapter,
  getTopupAggregatorAdapters,
} from "@/lib/topup/providers/registry";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function resolveProviderCode(headers: Headers, rawPayload: unknown) {
  const headerProvider = readString(headers.get("x-topup-provider"))?.toLowerCase();
  if (headerProvider) return headerProvider;

  if (rawPayload && typeof rawPayload === "object") {
    const payloadProvider = readString(
      (rawPayload as Record<string, unknown>).providerCode
    )?.toLowerCase();
    if (payloadProvider) return payloadProvider;
  }

  const matchingAdapter = getTopupAggregatorAdapters().find(
    (adapter) => typeof adapter.parseWebhook === "function"
  );

  return matchingAdapter?.providerCode ?? null;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let rawPayload: unknown = null;

    if (rawBody) {
      try {
        rawPayload = JSON.parse(rawBody);
      } catch {
        return jsonError("Webhook payload must be valid JSON.", 400);
      }
    }

    const providerCode = resolveProviderCode(request.headers, rawPayload);

    if (!providerCode) {
      return jsonError(
        "No top-up fulfillment provider could be resolved from the webhook."
      );
    }

    const adapter = getTopupAggregatorAdapter(providerCode);
    if (!adapter || typeof adapter.parseWebhook !== "function") {
      return jsonError(
        "No fulfillment webhook parser is configured for this provider.",
        400
      );
    }

    const providerStatusResult = await adapter.parseWebhook(
      rawPayload,
      request.headers,
      rawBody
    );
    if (!providerStatusResult) {
      return jsonError(
        "Unable to parse or verify the fulfillment webhook payload.",
        400
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await applyTopupFulfillmentWebhook({
      supabaseAdmin,
      providerCode,
      providerStatusResult,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/topup/webhooks/fulfillment error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to process top-up fulfillment webhook.",
      500
    );
  }
}
