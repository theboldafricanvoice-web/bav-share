import { authenticateTopupRequest } from "@/lib/topup/auth";
import { toCanonicalTopupOrderStatus } from "@/lib/topup/types";
import { maskMsisdn, jsonError } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticateTopupRequest(request);
    if (!auth.ok) return auth.response;

    const { data: orders, error } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .select(`
        id,
        order_ref,
        recipient_phone_number,
        recipient_msisdn,
        country,
        operator_name,
        data_plan_name,
        product_type,
        selling_price,
        sale_amount,
        payment_reference,
        currency,
        status,
        payment_status,
        fulfillment_status,
        created_at,
        data_topup_networks:network_id (
          id,
          name
        ),
        data_topup_products:product_id (
          id,
          display_name
        )
      `)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET /api/topup/orders/history error:", error);
      return jsonError("Unable to load top-up history.", 500);
    }

    const normalized = (orders ?? []).map((order: any) => ({
      id: order.id,
      orderRef: order.order_ref,
      status: toCanonicalTopupOrderStatus(order.status),
      rawStatus: order.status,
      paymentStatus: order.payment_status,
      fulfillmentStatus: order.fulfillment_status,
      networkName: order.operator_name || (Array.isArray(order.data_topup_networks)
        ? order.data_topup_networks[0]?.name ?? ""
        : order.data_topup_networks?.name ?? ""),
      operatorName: order.operator_name || (Array.isArray(order.data_topup_networks)
        ? order.data_topup_networks[0]?.name ?? ""
        : order.data_topup_networks?.name ?? ""),
      productType: order.product_type ?? "data_bundle",
      productName: order.data_plan_name || (Array.isArray(order.data_topup_products)
        ? order.data_topup_products[0]?.display_name ?? ""
        : order.data_topup_products?.display_name ?? ""),
      dataPlanName: order.data_plan_name || (Array.isArray(order.data_topup_products)
        ? order.data_topup_products[0]?.display_name ?? ""
        : order.data_topup_products?.display_name ?? ""),
      recipientMsisdnMasked: maskMsisdn(order.recipient_phone_number ?? order.recipient_msisdn),
      recipientPhoneNumberMasked: maskMsisdn(order.recipient_phone_number ?? order.recipient_msisdn),
      country: order.country,
      amountPaid: order.selling_price ?? order.sale_amount,
      saleAmount: order.sale_amount,
      receiptReference: order.payment_reference ?? order.order_ref,
      currency: order.currency,
      createdAt: order.created_at,
    }));

    return NextResponse.json({ orders: normalized });
  } catch (error) {
    console.error("GET /api/topup/orders/history unexpected error:", error);
    return jsonError("Unable to load top-up history.", 500);
  }
}
