import { authenticateTopupRequest } from "@/lib/topup/auth";
import { buildSupportCaseRef, jsonError, readString } from "@/lib/topup/utils";
import { TOPUP_SUPPORT_CASE_CATEGORIES } from "@/lib/topup/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CreateSupportCaseBody = {
  category?: string;
  message?: string;
};

function isCreateSupportCaseBody(value: unknown): value is CreateSupportCaseBody {
  if (!value || typeof value !== "object") return false;
  return true;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateTopupRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.");
    }

    if (!isCreateSupportCaseBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const category = readString(rawPayload.category);
    const message = readString(rawPayload.message);

    if (!category || !message) {
      return jsonError("category and message are required.");
    }

    if (!TOPUP_SUPPORT_CASE_CATEGORIES.includes(category as any)) {
      return jsonError("category is not supported.");
    }

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .select("id, user_id, order_ref, status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error("POST /api/topup/orders/[id]/support order lookup error:", orderError);
      return jsonError("Unable to validate top-up order.", 500);
    }

    if (!order) {
      return jsonError("Top-up order not found.", 404);
    }

    const caseRef = buildSupportCaseRef();

    const { data: supportCase, error: caseError } = await auth.supabaseAdmin
      .from("data_topup_support_cases")
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
      console.error("POST /api/topup/orders/[id]/support insert error:", caseError);
      return jsonError("Unable to create support case.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("data_topup_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "support_case_opened",
        message: "A support case was opened for this top-up order.",
        payload: {
          caseRef,
          category,
        },
      });

    if (eventError) {
      console.error("POST /api/topup/orders/[id]/support event insert error:", eventError);
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
    console.error("POST /api/topup/orders/[id]/support unexpected error:", error);
    return jsonError("Unable to create support case.", 500);
  }
}
