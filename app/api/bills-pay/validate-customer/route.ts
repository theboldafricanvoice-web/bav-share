import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { getBillsPayProviderAdapter } from "@/lib/billsPay/providers/registry";
import { jsonError, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ValidateCustomerBody = {
  billerId?: string;
  countryCode?: string;
  accountReference?: string;
  fields?: Record<string, string>;
};

function isValidateCustomerBody(value: unknown): value is ValidateCustomerBody {
  return !!value && typeof value === "object";
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.");
    }

    if (!isValidateCustomerBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const billerId = readString(rawPayload.billerId);
    const countryCode = readString(rawPayload.countryCode);
    const accountReference = readString(rawPayload.accountReference);

    if (!billerId || !countryCode || !accountReference) {
      return jsonError("billerId, countryCode, and accountReference are required.");
    }

    const { data: biller, error: billerError } = await auth.supabaseAdmin
      .from("bills_pay_billers")
      .select(`
        id,
        biller_code,
        country_code,
        supports_lookup,
        provider_id,
        bills_pay_providers:provider_id (
          code
        )
      `)
      .eq("id", billerId)
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .maybeSingle();

    if (billerError) {
      console.error("POST /api/bills-pay/validate-customer biller lookup error:", billerError);
      return jsonError("Unable to validate the selected biller.", 500);
    }

    if (!biller) {
      return jsonError("Selected biller was not found.", 404);
    }

    const providerCode = Array.isArray((biller as any).bills_pay_providers)
      ? (biller as any).bills_pay_providers[0]?.code ?? "manual"
      : (biller as any).bills_pay_providers?.code ?? "manual";

    const adapter = getBillsPayProviderAdapter(providerCode);
    if (!adapter) {
      return jsonError("No bills-pay provider adapter is configured for this biller.", 500);
    }

    if (!biller.supports_lookup) {
      return NextResponse.json({
        validation: {
          valid: true,
          customerName: null,
          providerMessage: "This biller does not require account lookup before payment.",
        },
      });
    }

    const validation = await adapter.validateCustomer({
      billerCode: biller.biller_code,
      countryCode,
      accountReference,
      fields: rawPayload.fields ?? {},
    });

    return NextResponse.json({
      validation,
    });
  } catch (error) {
    console.error("POST /api/bills-pay/validate-customer error:", error);
    return jsonError("Unable to validate bill account.", 500);
  }
}
