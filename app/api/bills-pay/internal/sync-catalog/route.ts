import { getSupabaseAdmin } from "@/lib/billsPay/auth";
import { syncReloadlyBillsPayCatalog } from "@/lib/billsPay/providers/reloadly";
import { jsonError, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type SyncBillsPayCatalogBody = {
  providerCode?: string;
  countryCodes?: string[];
  activate?: boolean;
};

function isAuthorizedInternalRequest(request: Request) {
  const configuredKey =
    process.env.BILLS_PAY_INTERNAL_API_KEY?.trim() ??
    process.env.TOPUP_INTERNAL_API_KEY?.trim();

  if (!configuredKey) {
    throw new Error("Missing BILLS_PAY_INTERNAL_API_KEY.");
  }

  const suppliedKey =
    readString(request.headers.get("x-bills-pay-internal-key")) ??
    readString(request.headers.get("x-topup-internal-key")) ??
    readString(request.headers.get("x-internal-api-key"));

  return suppliedKey === configuredKey;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorizedInternalRequest(request)) {
      return jsonError("Unauthorized internal catalog sync request.", 401);
    }

    const rawPayload = (await request.json().catch(() => ({}))) as SyncBillsPayCatalogBody;
    const providerCode =
      readString(rawPayload.providerCode)?.toLowerCase() ?? "reloadly";
    const countryCodes = Array.isArray(rawPayload.countryCodes)
      ? rawPayload.countryCodes
          .map((value) => readString(value))
          .filter((value): value is string => Boolean(value))
      : ["SL"];
    const activate = Boolean(rawPayload.activate);

    if (providerCode !== "reloadly") {
      return jsonError(
        `Unsupported bills-pay catalog provider: ${providerCode}.`,
        400
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await syncReloadlyBillsPayCatalog({
      supabaseAdmin,
      countryCodes,
      activate,
    });

    return NextResponse.json({
      ok: true,
      sync: result,
    });
  } catch (error) {
    console.error("POST /api/bills-pay/internal/sync-catalog error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to sync the bills-pay catalog.",
      500
    );
  }
}
