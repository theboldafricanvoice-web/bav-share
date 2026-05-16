import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { toCanonicalBillsPayOrderStatus } from "@/lib/billsPay/types";
import { jsonError, maskReference } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    const { data: orders, error } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .select(`
        id,
        order_ref,
        status,
        payment_status,
        fulfillment_status,
        country_code,
        customer_reference,
        bill_amount,
        service_fee,
        selling_price,
        currency,
        payment_reference,
        created_at,
        bills_pay_billers:biller_id (
          name
        ),
        bills_pay_categories:category_id (
          name
        )
      `)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/bills-pay/orders/history error:", error);
      return jsonError("Unable to load bills-pay history.", 500);
    }

    return NextResponse.json({
      orders: (orders ?? []).map((order: any) => ({
        id: order.id,
        orderRef: order.order_ref,
        status: toCanonicalBillsPayOrderStatus(order.status),
        rawStatus: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        countryCode: order.country_code,
        categoryName: Array.isArray(order.bills_pay_categories)
          ? order.bills_pay_categories[0]?.name ?? ""
          : order.bills_pay_categories?.name ?? "",
        billerName: Array.isArray(order.bills_pay_billers)
          ? order.bills_pay_billers[0]?.name ?? ""
          : order.bills_pay_billers?.name ?? "",
        customerReferenceMasked: maskReference(order.customer_reference),
        billAmount: order.bill_amount,
        serviceFee: order.service_fee,
        amountPaid: order.selling_price,
        receiptReference: order.payment_reference ?? order.order_ref,
        currency: order.currency,
        createdAt: order.created_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/bills-pay/orders/history unexpected error:", error);
    return jsonError("Unable to load bills-pay history.", 500);
  }
}
