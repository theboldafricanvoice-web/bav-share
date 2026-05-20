import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import {
  executeQueuedBillsPayOrder,
  queueBillsPayOrderForFulfillment,
} from "@/lib/billsPay/fulfillment";
import { toCanonicalBillsPayOrderStatus } from "@/lib/billsPay/types";
import { jsonError, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ConfirmBillsPayPaymentBody = {
  paymentProvider?: string;
  paymentReference?: string;
  externalTransactionId?: string | null;
};

function isConfirmBillsPayPaymentBody(
  value: unknown
): value is ConfirmBillsPayPaymentBody {
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

    if (!isConfirmBillsPayPaymentBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const paymentProvider = readString(rawPayload.paymentProvider);
    const paymentReference = readString(rawPayload.paymentReference);
    const externalTransactionId = readString(rawPayload.externalTransactionId ?? null);

    if (!paymentProvider || !paymentReference) {
      return jsonError("paymentProvider and paymentReference are required.");
    }

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .select("id, order_ref, selling_price, currency, status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error(
        "POST /api/bills-pay/orders/[id]/confirm-payment order lookup error:",
        orderError
      );
      return jsonError("Unable to validate the bills-pay order.", 500);
    }

    if (!order) {
      return jsonError("Bills-pay order not found.", 404);
    }

    const { data: payment, error: paymentError } = await auth.supabaseAdmin
      .from("bills_pay_payments")
      .upsert(
        {
          order_id: order.id,
          payment_provider: paymentProvider,
          payment_reference: paymentReference,
          external_transaction_id: externalTransactionId,
          currency: order.currency,
          amount: order.selling_price,
          status: paymentProvider === "manual" ? "verified" : "pending",
        },
        {
          onConflict: "payment_provider,payment_reference",
        }
      )
      .select("id, payment_provider, payment_reference, status")
      .single();

    if (paymentError || !payment) {
      console.error(
        "POST /api/bills-pay/orders/[id]/confirm-payment payment upsert error:",
        paymentError
      );
      return jsonError("Unable to record bills-pay payment.", 500);
    }

    const nextStatus = paymentProvider === "manual" ? "payment_verified" : "pending_payment";
    const nextPaymentStatus = paymentProvider === "manual" ? "verified" : "pending";

    const { data: updatedOrder, error: orderUpdateError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .update({
        payment_provider: paymentProvider,
        payment_reference: paymentReference,
        status: nextStatus,
        payment_status: nextPaymentStatus,
        ...(paymentProvider === "manual" ? { paid_at: new Date().toISOString() } : {}),
      })
      .eq("id", order.id)
      .select("id, order_ref, status, payment_status, fulfillment_status")
      .single();

    if (orderUpdateError || !updatedOrder) {
      console.error(
        "POST /api/bills-pay/orders/[id]/confirm-payment order update error:",
        orderUpdateError
      );
      return jsonError("Unable to update bills-pay order payment state.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("bills_pay_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "payment_reported",
        message:
          paymentProvider === "manual"
            ? "Manual demo payment was marked verified for sandbox testing."
            : "Payment reference submitted for backend verification.",
        payload: {
          paymentProvider,
          paymentReference,
          externalTransactionId,
        },
      });

    if (eventError) {
      console.error(
        "POST /api/bills-pay/orders/[id]/confirm-payment event insert error:",
        eventError
      );
    }

    if (paymentProvider === "manual") {
      await queueBillsPayOrderForFulfillment({
        supabaseAdmin: auth.supabaseAdmin,
        orderId: order.id,
        source: "manual_confirmation",
      });

      await executeQueuedBillsPayOrder({
        supabaseAdmin: auth.supabaseAdmin,
        orderId: order.id,
      }).catch((error) => {
        console.error(
          "POST /api/bills-pay/orders/[id]/confirm-payment fulfillment execution error:",
          error
        );
      });
    }

    return NextResponse.json({
      order: {
        id: updatedOrder.id,
        orderRef: updatedOrder.order_ref,
        status: toCanonicalBillsPayOrderStatus(updatedOrder.status),
        rawStatus: updatedOrder.status,
        paymentStatus: updatedOrder.payment_status,
        fulfillmentStatus: updatedOrder.fulfillment_status,
      },
      payment: {
        id: payment.id,
        paymentProvider: payment.payment_provider,
        paymentReference: payment.payment_reference,
        status: payment.status,
      },
      nextStep:
        paymentProvider === "manual"
          ? "Manual demo payment marked as verified and queued for bill settlement."
          : "Payment reference received. Backend verification must complete before any bill payment is sent.",
    });
  } catch (error) {
    console.error("POST /api/bills-pay/orders/[id]/confirm-payment unexpected error:", error);
    return jsonError("Unable to confirm bills-pay payment.", 500);
  }
}
