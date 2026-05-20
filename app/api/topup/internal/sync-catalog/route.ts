import { getSupabaseAdmin } from "@/lib/topup/auth";
import { syncDingConnectCatalog } from "@/lib/topup/providers/dingconnect";
import { syncDtOneCatalog } from "@/lib/topup/providers/dtone";
import { syncReloadlyCatalog } from "@/lib/topup/providers/reloadly";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type SyncCatalogBody = {
  providerCode?: string;
  countryCodes?: string[];
  activate?: boolean;
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
      return jsonError("Unauthorized internal catalog sync request.", 401);
    }

    const rawPayload = (await request.json().catch(() => ({}))) as SyncCatalogBody;
    const providerCode = readString(rawPayload.providerCode)?.toLowerCase() ?? "reloadly";
    const countryCodes = Array.isArray(rawPayload.countryCodes)
      ? rawPayload.countryCodes
          .map((value) => readString(value))
          .filter((value): value is string => Boolean(value))
      : ["SL"];
    const activate = Boolean(rawPayload.activate);

    if (providerCode === "reloadly") {
      const supabaseAdmin = getSupabaseAdmin();
      const result = await syncReloadlyCatalog({
        supabaseAdmin,
        countryCodes,
        activate,
      });

      return NextResponse.json({
        ok: true,
        sync: result,
      });
    }

    if (providerCode === "dingconnect") {
      const supabaseAdmin = getSupabaseAdmin();
      const result = await syncDingConnectCatalog({
        supabaseAdmin,
        countryCodes,
        activate,
      });

      return NextResponse.json({
        ok: true,
        sync: result,
      });
    }

    if (providerCode === "dtone") {
      const supabaseAdmin = getSupabaseAdmin();
      const result = await syncDtOneCatalog({
        supabaseAdmin,
        countryCodes,
        activate,
      });

      return NextResponse.json({
        ok: true,
        sync: result,
      });
    }

    {
      return jsonError(`Unsupported top-up catalog provider: ${providerCode}.`, 400);
    }
  } catch (error) {
    console.error("POST /api/topup/internal/sync-catalog error:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to sync the top-up catalog.",
      500
    );
  }
}
