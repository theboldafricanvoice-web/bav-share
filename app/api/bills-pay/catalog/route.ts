import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { jsonError, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const countryCode = readString(searchParams.get("countryCode"));
    const categoryId = readString(searchParams.get("categoryId"));

    const categoriesQuery = auth.supabaseAdmin
      .from("bills_pay_categories")
      .select("id, code, name, description, icon_name, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    const { data: categories, error: categoriesError } = await categoriesQuery;

    if (categoriesError) {
      console.error("GET /api/bills-pay/catalog categories error:", categoriesError);
      return jsonError("Unable to load bill categories.", 500);
    }

    let billersQuery = auth.supabaseAdmin
      .from("bills_pay_billers")
      .select(`
        id,
        provider_id,
        category_id,
        country_code,
        biller_code,
        name,
        description,
        currency,
        supports_lookup,
        supports_fixed_amount,
        supports_variable_amount,
        min_amount,
        max_amount,
        required_fields,
        is_active
      `)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (countryCode) {
      billersQuery = billersQuery.eq("country_code", countryCode);
    }

    if (categoryId) {
      billersQuery = billersQuery.eq("category_id", categoryId);
    }

    const { data: billers, error: billersError } = await billersQuery;

    if (billersError) {
      console.error("GET /api/bills-pay/catalog billers error:", billersError);
      return jsonError("Unable to load billers.", 500);
    }

    return NextResponse.json({
      categories: categories ?? [],
      billers: billers ?? [],
    });
  } catch (error) {
    console.error("GET /api/bills-pay/catalog error:", error);
    return jsonError("Unable to load bills-pay catalog.", 500);
  }
}
