import { authenticateTopupRequest } from "@/lib/topup/auth";
import { executeQueuedTopupOrder } from "@/lib/topup/fulfillment";
import { finalizeVerifiedTopupPayment } from "@/lib/topup/payments";
import { isPendingTopupPaymentState, toCanonicalTopupOrderStatus } from "@/lib/topup/types";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ConfirmPaymentBody = {
  paymentProvider?: string;
  paymentReference?: string;
  externalTransactionId?: string | null;
};

function isConfirmPaymentBody(value: unknown): value is ConfirmPaymentBody {
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

    if (!isConfirmPaymentBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const paymentProvider = readString(rawPayload.paymentProvider);
    const paymentReference = readString(rawPayload.paymentReference);
    const externalTransactionId = readString(rawPayload.externalTransactionId);

    if (!paymentProvider || !paymentReference) {
      return jsonError("paymentProvider and paymentReference are required.");
    }

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .select("id, user_id, order_ref, currency, sale_amount, status, payment_status, fulfillment_status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error("POST /api/topup/orders/[id]/confirm-payment order lookup error:", orderError);
      return jsonError("Unable to validate top-up order.", 500);
    }

    if (!order) {
      return jsonError("Top-up order not found.", 404);
    }

    if (!isPendingTopupPaymentState(order.status)) {
      return jsonError("This top-up order cannot accept payment confirmation in its current state.");
    }

    const nowIso = new Date().toISOString();

    const { data: payment, error: paymentError } = await auth.supabaseAdmin
      .from("data_topup_payments")
      .upsert(
        {
          order_id: order.id,
          payment_provider: paymentProvider,
          payment_reference: paymentReference,
          external_transaction_id: externalTransactionId,
          currency: order.currency,
          amount: order.sale_amount,
          status: "pending",
          webhook_payload: {},
          verification_payload: {
            source: "confirm-payment-endpoint",
            note: "Payment verification is pending server-side verification or webhook processing.",
            capturedAt: nowIso,
          },
        },
        {
          onConflict: "payment_provider,payment_reference",
        }
      )
      .select("id, payment_provider, payment_reference, status, created_at, updated_at")
      .single();

    if (paymentError || !payment) {
      console.error("POST /api/topup/orders/[id]/confirm-payment payment upsert error:", paymentError);
      return jsonError("Unable to register payment confirmation.", 500);
    }

    const { error: orderUpdateError } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .update({
        status: "pending_payment",
        payment_status: "pending",
        payment_provider: paymentProvider,
        payment_reference: paymentReference,
      })
      .eq("id", order.id);

    if (orderUpdateError) {
      console.error("POST /api/topup/orders/[id]/confirm-payment order update error:", orderUpdateError);
      return jsonError("Unable to update top-up order payment status.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("data_topup_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "payment_confirmation_submitted",
        message: "Payment confirmation was submitted and is awaiting server verification.",
        payload: {
          paymentProvider,
          paymentReference,
          externalTransactionId,
        },
      });

    if (eventError) {
      console.error("POST /api/topup/orders/[id]/confirm-payment event insert error:", eventError);
    }

    if (paymentProvider === "manual") {
      const verificationResult = await finalizeVerifiedTopupPayment({
        supabaseAdmin: auth.supabaseAdmin,
        paymentProvider,
        paymentReference,
        externalTransactionId,
        amount: Number(order.sale_amount),
        currency: order.currency,
        raw: {
          source: "confirm-payment-endpoint",
          mode: "manual_demo",
          paymentProvider,
          paymentReference,
          externalTransactionId,
          orderId: order.id,
          orderRef: order.order_ref,
        },
      });

      const fulfillmentResult = await executeQueuedTopupOrder({
        supabaseAdmin: auth.supabaseAdmin,
        orderId: order.id,
      });

      const { data: refreshedOrder, error: refreshedOrderError } = await auth.supabaseAdmin
        .from("data_topup_orders")
        .select("id, order_ref, status, payment_status, fulfillment_status")
        .eq("id", order.id)
        .maybeSingle();

      if (refreshedOrderError || !refreshedOrder) {
        console.error(
          "POST /api/topup/orders/[id]/confirm-payment refreshed order error:",
          refreshedOrderError
        );
        return jsonError("Unable to load updated top-up order state.", 500);
      }

      return NextResponse.json({
        order: {
          id: refreshedOrder.id,
          orderRef: refreshedOrder.order_ref,
          status: toCanonicalTopupOrderStatus(refreshedOrder.status),
          rawStatus: refreshedOrder.status,
          paymentStatus: refreshedOrder.payment_status,
          fulfillmentStatus: refreshedOrder.fulfillment_status,
        },
        payment: {
          id: payment.id,
          paymentProvider: payment.payment_provider,
          paymentReference: payment.payment_reference,
          status:
            verificationResult.alreadyVerified || refreshedOrder.payment_status === "verified"
              ? "verified"
              : payment.status,
        },
        nextStep: fulfillmentResult.ok
          ? "Manual demo payment was verified and the top-up was fulfilled immediately."
          : "Manual demo payment was verified. Fulfillment is queued for processing.",
      });
    }

    return NextResponse.json({
        order: {
          id: order.id,
          orderRef: order.order_ref,
        status: "pending_payment",
        rawStatus: "pending_payment",
        paymentStatus: "pending",
        fulfillmentStatus: order.fulfillment_status,
      },
      payment: {
        id: payment.id,
        paymentProvider: payment.payment_provider,
        paymentReference: payment.payment_reference,
        status: payment.status,
      },
      nextStep:
        "Payment confirmation was received. The order will remain pending until the backend verifies payment securely.",
    });
  } catch (error) {
    console.error("POST /api/topup/orders/[id]/confirm-payment unexpected error:", error);
    return jsonError("Unable to confirm top-up payment.", 500);
  }
}
