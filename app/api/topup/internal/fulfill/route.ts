import { executeQueuedTopupOrder } from "@/lib/topup/fulfillment";
import { getSupabaseAdmin } from "@/lib/topup/auth";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FulfillBody = {
  orderId?: string;
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
      return jsonError("Unauthorized internal top-up fulfillment request.", 401);
    }

    const rawPayload = (await request.json().catch(() => ({}))) as FulfillBody;
    const orderId = readString(rawPayload.orderId);

    const supabaseAdmin = getSupabaseAdmin();
    const result = await executeQueuedTopupOrder({
      supabaseAdmin,
      orderId: orderId ?? undefined,
    });

    if (!result.ok) {
      return NextResponse.json(result);
    }

    return NextResponse.json({
      ok: true,
      fulfillment: result,
    });
  } catch (error) {
    console.error("POST /api/topup/internal/fulfill error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to execute internal top-up fulfillment.",
      500
    );
  }
}
