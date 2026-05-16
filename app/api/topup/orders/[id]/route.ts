import { authenticateTopupRequest } from "@/lib/topup/auth";
import { toCanonicalTopupOrderStatus } from "@/lib/topup/types";
import { jsonError, maskMsisdn } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateTopupRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .select(`
        *,
        data_topup_networks:network_id (
          id,
          name,
          country_code,
          network_code
        ),
        data_topup_products:product_id (
          id,
          display_name,
          description,
          currency,
          face_value,
          retail_price,
          data_volume_label,
          validity_label
        )
      `)
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error("GET /api/topup/orders/[id] order error:", orderError);
      return jsonError("Unable to load top-up order.", 500);
    }

    if (!order) {
      return jsonError("Top-up order not found.", 404);
    }

    const [paymentsResult, refundsResult, supportCasesResult, eventsResult] =
      await Promise.all([
        auth.supabaseAdmin
          .from("data_topup_payments")
          .select("*")
          .eq("order_id", id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("data_topup_refunds")
          .select("*")
          .eq("order_id", id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("data_topup_support_cases")
          .select("*")
          .eq("order_id", id)
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("data_topup_order_events")
          .select("*")
          .eq("order_id", id)
          .order("created_at", { ascending: false }),
      ]);

    if (
      paymentsResult.error ||
      refundsResult.error ||
      supportCasesResult.error ||
      eventsResult.error
    ) {
      console.error("GET /api/topup/orders/[id] related data error:", {
        payments: paymentsResult.error,
        refunds: refundsResult.error,
        supportCases: supportCasesResult.error,
        events: eventsResult.error,
      });
      return jsonError("Unable to load top-up order details.", 500);
    }

    return NextResponse.json({
      order: {
        ...order,
        status: toCanonicalTopupOrderStatus(String(order.status ?? "")),
        raw_status: order.status,
        product_type: order.product_type ?? "data_bundle",
        recipient_phone_number_masked: maskMsisdn(
          order.recipient_phone_number ?? order.recipient_msisdn
        ),
        recipient_msisdn_masked: maskMsisdn(order.recipient_msisdn),
        receipt_reference: order.payment_reference ?? order.order_ref,
        amount_paid: order.selling_price ?? order.sale_amount,
      },
      payments: paymentsResult.data ?? [],
      refunds: refundsResult.data ?? [],
      supportCases: supportCasesResult.data ?? [],
      events: eventsResult.data ?? [],
    });
  } catch (error) {
    console.error("GET /api/topup/orders/[id] unexpected error:", error);
    return jsonError("Unable to load top-up order details.", 500);
  }
}
