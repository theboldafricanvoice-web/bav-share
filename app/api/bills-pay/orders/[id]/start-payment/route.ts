import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import {
  getBillsPayPaymentProviderAdapter,
  getDefaultBillsPayPaymentProviderCode,
  getBillsPayPaymentProviderReadiness,
} from "@/lib/billsPay/paymentProviders/registry";
import { jsonError } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .select("id, user_id, order_ref, selling_price, currency, status")
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (orderError) {
      console.error(
        "POST /api/bills-pay/orders/[id]/start-payment order lookup error:",
        orderError
      );
      return jsonError("Unable to validate the bills-pay order.", 500);
    }

    if (!order) {
      return jsonError("Bills-pay order not found.", 404);
    }

    if (order.status !== "pending_payment") {
      return jsonError("Payment can only be started for pending bills-pay orders.");
    }

    const providerCode = getDefaultBillsPayPaymentProviderCode();
    const adapter = getBillsPayPaymentProviderAdapter(providerCode);

    if (!adapter) {
      return jsonError("No bills-pay payment provider is configured.", 500);
    }

    const readiness = getBillsPayPaymentProviderReadiness(providerCode);
    if (!readiness.ready) {
      return NextResponse.json(
        {
          error:
            providerCode === "stripe"
              ? "Bills Pay secure checkout is not configured fully yet. Please finish the Stripe setup or switch back to sandbox mode."
              : "The configured bills-pay payment provider is not ready yet.",
          paymentProvider: providerCode,
          missingConfiguration: readiness.issues,
        },
        { status: 503 }
      );
    }

    const session = await adapter.startPaymentSession({
      orderId: order.id,
      orderRef: order.order_ref,
      amount: Number(order.selling_price),
      currency: order.currency,
      email: auth.user.email ?? null,
    });

    const { data: payment, error: paymentError } = await auth.supabaseAdmin
      .from("bills_pay_payments")
      .upsert(
        {
          order_id: order.id,
          payment_provider: session.paymentProvider,
          payment_reference: session.paymentReference,
          external_transaction_id: session.externalTransactionId ?? null,
          currency: order.currency,
          amount: order.selling_price,
          status: "initiated",
          verification_payload: {
            source: "start_payment",
            startedAt: new Date().toISOString(),
            raw: session.raw,
          },
        },
        {
          onConflict: "payment_provider,payment_reference",
        }
      )
      .select("id, payment_provider, payment_reference, status")
      .single();

    if (paymentError || !payment) {
      console.error(
        "POST /api/bills-pay/orders/[id]/start-payment payment upsert error:",
        paymentError
      );
      return jsonError("Unable to start bills-pay payment session.", 500);
    }

    const { error: orderUpdateError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .update({
        payment_provider: session.paymentProvider,
        payment_reference: session.paymentReference,
        payment_status: "initiated",
      })
      .eq("id", order.id);

    if (orderUpdateError) {
      console.error(
        "POST /api/bills-pay/orders/[id]/start-payment order update error:",
        orderUpdateError
      );
      return jsonError("Unable to prepare the bills-pay order for payment.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("bills_pay_order_events")
      .insert({
        order_id: order.id,
        actor_type: "system",
        event_type: "payment_session_started",
        message: `Payment session started with ${session.paymentProvider}.`,
        payload: {
          paymentProvider: session.paymentProvider,
          paymentReference: session.paymentReference,
          mode: session.mode,
        },
      });

    if (eventError) {
      console.error(
        "POST /api/bills-pay/orders/[id]/start-payment event insert error:",
        eventError
      );
    }

    return NextResponse.json({
      paymentSession: {
        paymentProvider: session.paymentProvider,
        mode: session.mode,
        paymentReference: session.paymentReference,
        checkoutUrl: session.checkoutUrl ?? null,
        externalTransactionId: session.externalTransactionId ?? null,
        message: session.message ?? null,
      },
      payment: {
        id: payment.id,
        paymentProvider: payment.payment_provider,
        paymentReference: payment.payment_reference,
        status: payment.status,
      },
    });
  } catch (error) {
    console.error("POST /api/bills-pay/orders/[id]/start-payment unexpected error:", error);
    return jsonError("Unable to start bills-pay payment.", 500);
  }
}
