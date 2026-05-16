import { getSupabaseAdmin } from "@/lib/topup/auth";
import { reconcileTopupFulfillmentAttempt } from "@/lib/topup/fulfillment";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ReconcileBody = {
  orderId?: string;
  providerRequestRef?: string;
  providerTransactionRef?: string;
};

function isAuthorizedInternalRequest(request: Request) {
  const configuredKey = process.env.TOPUP_INTERNAL_API_KEY?.trim();
  if (!configuredKey) {
    throw new Error("Missing TOPUP_INTERNAL_API_KEY.");
  }

  const suppliedKey =
    readString(request.headers.get("x-topup-internal-key")) ??
    readString(request.headers.get("x-internal-api-key"));

  return suppliedKey === configuredKey;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return jsonError("Unauthorized internal fulfillment reconciliation request.", 401);
    }

    const rawPayload = (await request.json().catch(() => ({}))) as ReconcileBody;
    const orderId = readString(rawPayload.orderId);
    const providerRequestRef = readString(rawPayload.providerRequestRef);
    const providerTransactionRef = readString(rawPayload.providerTransactionRef);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await reconcileTopupFulfillmentAttempt({
      supabaseAdmin,
      orderId: orderId ?? undefined,
      providerRequestRef: providerRequestRef ?? undefined,
      providerTransactionRef: providerTransactionRef ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/topup/internal/reconcile-fulfillment error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to reconcile internal top-up fulfillment.",
      500
    );
  }
}
