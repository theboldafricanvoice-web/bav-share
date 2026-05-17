import { getSupabaseAdmin } from "@/lib/topup/auth";
import { cleanupStaleTopupOrders } from "@/lib/topup/fulfillment";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CleanupBody = {
  olderThanMinutes?: number;
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
      return jsonError("Unauthorized internal stale-order cleanup request.", 401);
    }

    const rawPayload = (await request.json().catch(() => ({}))) as CleanupBody;
    const olderThanMinutes =
      typeof rawPayload.olderThanMinutes === "number" &&
      Number.isFinite(rawPayload.olderThanMinutes)
        ? rawPayload.olderThanMinutes
        : undefined;

    const supabaseAdmin = getSupabaseAdmin();
    const result = await cleanupStaleTopupOrders({
      supabaseAdmin,
      olderThanMinutes,
    });

    return NextResponse.json({
      ok: true,
      cleanup: result,
    });
  } catch (error) {
    console.error("POST /api/topup/internal/cleanup-stale-orders error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to clean up stale top-up orders.",
      500
    );
  }
}
