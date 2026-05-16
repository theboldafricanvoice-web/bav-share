import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { BILLS_PAY_SUPPORT_CASE_CATEGORIES } from "@/lib/billsPay/types";
import { buildBillsPaySupportCaseRef, jsonError, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CreateBillsPaySupportCaseBody = {
  category?: string;
  message?: string;
};

function isCreateBillsPaySupportCaseBody(
  value: unknown
): value is CreateBillsPaySupportCaseBody {
  return !!value && typeof value === "object";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.");
    }

    if (!isCreateBillsPaySupportCaseBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const category = readString(rawPayload.category);
    const message = readString(rawPayload.message);

    if (!category || !message) {
      return jsonError("category and message are required.");
    }

    if (
      !BILLS_PAY_SUPPORT_CASE_CATEGORIES.includes(
        category as (typeof BILLS_PAY_SUPPORT_CASE_CATEGORIES)[number]
      )
    ) {
      return jsonError("Invalid support category.");
    }

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .select("id")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error("POST /api/bills-pay/orders/[id]/support order lookup error:", orderError);
      return jsonError("Unable to validate the bills-pay order.", 500);
    }

    if (!order) {
      return jsonError("Bills-pay order not found.", 404);
    }

    const caseRef = buildBillsPaySupportCaseRef();

    const { data: supportCase, error: caseError } = await auth.supabaseAdmin
      .from("bills_pay_support_cases")
      .insert({
        order_id: order.id,
        user_id: auth.user.id,
        case_ref: caseRef,
        status: "open",
        priority: "normal",
        category,
        user_message: message,
      })
      .select("id, case_ref, status, category, created_at")
      .single();

    if (caseError || !supportCase) {
      console.error("POST /api/bills-pay/orders/[id]/support insert error:", caseError);
      return jsonError("Unable to create support case.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("bills_pay_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "support_case_opened",
        message: "A support case was opened for this bills-pay order.",
        payload: {
          caseRef,
          category,
        },
      });

    if (eventError) {
      console.error("POST /api/bills-pay/orders/[id]/support event insert error:", eventError);
    }

    return NextResponse.json({
      case: {
        id: supportCase.id,
        caseRef: supportCase.case_ref,
        status: supportCase.status,
        category: supportCase.category,
        createdAt: supportCase.created_at,
      },
    });
  } catch (error) {
    console.error("POST /api/bills-pay/orders/[id]/support unexpected error:", error);
    return jsonError("Unable to create support case.", 500);
  }
}
