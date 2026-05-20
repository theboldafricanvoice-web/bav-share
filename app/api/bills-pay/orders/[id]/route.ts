import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { reconcileBillsPayOrderFulfillment } from "@/lib/billsPay/fulfillment";
import { toCanonicalBillsPayOrderStatus } from "@/lib/billsPay/types";
import { jsonError, maskReference } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;

    let { data: order, error: orderError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .select(`
        *,
        bills_pay_billers:biller_id (
          name
        ),
        bills_pay_categories:category_id (
          name
        )
      `)
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error("GET /api/bills-pay/orders/[id] order error:", orderError);
      return jsonError("Unable to load bills-pay transaction.", 500);
    }

    if (!order) {
      return jsonError("Bills-pay transaction not found.", 404);
    }

    if (
      order.status === "processing_bill_payment" &&
      ["queued", "in_progress", "unknown"].includes(
        String(order.fulfillment_status ?? "")
      )
    ) {
      await reconcileBillsPayOrderFulfillment({
        supabaseAdmin: auth.supabaseAdmin,
        orderId: order.id,
      }).catch((error) => {
        console.error(
          "GET /api/bills-pay/orders/[id] fulfillment reconciliation error:",
          error
        );
      });

      const refreshedOrder = await auth.supabaseAdmin
        .from("bills_pay_orders")
        .select(`
          *,
          bills_pay_billers:biller_id (
            name
          ),
          bills_pay_categories:category_id (
            name
          )
        `)
        .eq("id", order.id)
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (!refreshedOrder.error && refreshedOrder.data) {
        order = refreshedOrder.data;
      }
    }

    const [paymentsResult, refundsResult, supportCasesResult, eventsResult] =
      await Promise.all([
        auth.supabaseAdmin
          .from("bills_pay_payments")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("bills_pay_refunds")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("bills_pay_support_cases")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false }),
        auth.supabaseAdmin
          .from("bills_pay_order_events")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at", { ascending: false }),
      ]);

    if (
      paymentsResult.error ||
      refundsResult.error ||
      supportCasesResult.error ||
      eventsResult.error
    ) {
      console.error("GET /api/bills-pay/orders/[id] related data error:", {
        payments: paymentsResult.error,
        refunds: refundsResult.error,
        support: supportCasesResult.error,
        events: eventsResult.error,
      });
      return jsonError("Unable to load bills-pay transaction detail.", 500);
    }

    return NextResponse.json({
      order: {
        ...order,
        status: toCanonicalBillsPayOrderStatus(order.status),
        raw_status: order.status,
        biller_name: Array.isArray((order as any).bills_pay_billers)
          ? (order as any).bills_pay_billers[0]?.name ?? null
          : (order as any).bills_pay_billers?.name ?? null,
        category_name: Array.isArray((order as any).bills_pay_categories)
          ? (order as any).bills_pay_categories[0]?.name ?? null
          : (order as any).bills_pay_categories?.name ?? null,
        customer_reference_masked: maskReference(order.customer_reference),
        receipt_reference: order.payment_reference ?? order.order_ref,
        amount_paid: order.selling_price,
      },
      payments: paymentsResult.data ?? [],
      refunds: refundsResult.data ?? [],
      supportCases: supportCasesResult.data ?? [],
      events: eventsResult.data ?? [],
    });
  } catch (error) {
    console.error("GET /api/bills-pay/orders/[id] unexpected error:", error);
    return jsonError("Unable to load bills-pay transaction detail.", 500);
  }
}
