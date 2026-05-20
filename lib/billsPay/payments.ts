import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executeQueuedBillsPayOrder,
  queueBillsPayOrderForFulfillment,
} from "@/lib/billsPay/fulfillment";
import { readString } from "@/lib/billsPay/utils";

export type NormalizedBillsPayPaymentWebhookEvent = {
  paymentProvider: string;
  paymentReference: string;
  externalTransactionId?: string | null;
  eventType: "payment_verified" | "payment_failed" | "payment_reversed";
  amount?: number | null;
  currency?: string | null;
  raw: Record<string, unknown>;
};

export function isKnownBillsPayPaymentProvider(provider: string) {
  return ["manual", "paystack", "flutterwave", "stripe"].includes(provider);
}

export async function finalizeVerifiedBillsPayPayment(params: {
  supabaseAdmin: SupabaseClient;
  paymentProvider: string;
  paymentReference: string;
  externalTransactionId?: string | null;
  amount?: number | null;
  currency?: string | null;
  raw: Record<string, unknown>;
}) {
  const { supabaseAdmin } = params;

  const { data: payment, error: paymentLookupError } = await supabaseAdmin
    .from("bills_pay_payments")
    .select(`
      id,
      order_id,
      payment_provider,
      payment_reference,
      external_transaction_id,
      currency,
      amount,
      status,
      bills_pay_orders:order_id (
        id,
        user_id,
        order_ref,
        status,
        payment_status,
        fulfillment_status
      )
    `)
    .eq("payment_provider", params.paymentProvider)
    .eq("payment_reference", params.paymentReference)
    .maybeSingle();

  if (paymentLookupError) {
    throw new Error("Unable to look up bills-pay payment reference.");
  }

  if (!payment) {
    throw new Error("Bills-pay payment reference was not found.");
  }

  const order = Array.isArray((payment as any).bills_pay_orders)
    ? (payment as any).bills_pay_orders[0] ?? null
    : (payment as any).bills_pay_orders ?? null;

  if (!order?.id) {
    throw new Error("Bills-pay order linked to the payment was not found.");
  }

  if (payment.status === "verified" && order.status === "payment_verified") {
    const fulfillmentResult = await executeQueuedBillsPayOrder({
      supabaseAdmin,
      orderId: order.id,
    }).catch((error) => {
      console.error(
        "finalizeVerifiedBillsPayPayment already-verified fulfillment execution error:",
        error
      );
      return null;
    });

    return {
      payment,
      order,
      alreadyVerified: true,
      queuedForFulfillment: false,
      fulfillmentTriggered: Boolean(fulfillmentResult?.ok),
    };
  }

  if (
    typeof params.amount === "number" &&
    Number.isFinite(params.amount) &&
    Number(params.amount) !== Number(payment.amount)
  ) {
    throw new Error("Payment amount does not match the bills-pay order amount.");
  }

  const normalizedCurrency = readString(params.currency)?.toUpperCase() ?? null;
  if (
    normalizedCurrency &&
    normalizedCurrency !== String(payment.currency ?? "").toUpperCase()
  ) {
    throw new Error("Payment currency does not match the bills-pay order currency.");
  }

  const nowIso = new Date().toISOString();

  const { error: paymentUpdateError } = await supabaseAdmin
    .from("bills_pay_payments")
    .update({
      status: "verified",
      external_transaction_id:
        readString(params.externalTransactionId) ?? payment.external_transaction_id ?? null,
      verification_payload: {
        source: "payment_webhook",
        verifiedAt: nowIso,
        raw: params.raw,
      },
      webhook_payload: params.raw,
      verified_at: nowIso,
    })
    .eq("id", payment.id);

  if (paymentUpdateError) {
    throw new Error("Unable to update verified bills-pay payment.");
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("bills_pay_orders")
    .update({
      status: "payment_verified",
      payment_status: "verified",
      payment_provider: params.paymentProvider,
      payment_reference: params.paymentReference,
      paid_at: nowIso,
    })
    .eq("id", order.id);

  if (orderUpdateError) {
    throw new Error("Unable to update bills-pay order payment state.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("bills_pay_order_events")
    .insert({
      order_id: order.id,
      actor_type: "payment_provider",
      event_type: "payment_verified",
      message: "Payment was verified server-side.",
      payload: {
        paymentProvider: params.paymentProvider,
        paymentReference: params.paymentReference,
        externalTransactionId: readString(params.externalTransactionId),
      },
    });

  if (eventError) {
    console.error("finalizeVerifiedBillsPayPayment event insert error:", eventError);
  }

  const queueResult = await queueBillsPayOrderForFulfillment({
    supabaseAdmin,
    orderId: order.id,
    source: "payment_webhook",
  });

  const fulfillmentResult = await executeQueuedBillsPayOrder({
    supabaseAdmin,
    orderId: order.id,
  }).catch((error) => {
    console.error(
      "finalizeVerifiedBillsPayPayment fulfillment execution error:",
      error
    );
    return null;
  });

  return {
    payment,
    order:
      queueResult.order ?? {
        ...order,
        status: "payment_verified",
        payment_status: "verified",
      },
    alreadyVerified: false,
    queuedForFulfillment: !queueResult.alreadyQueued,
    fulfillmentTriggered: Boolean(fulfillmentResult?.ok),
  };
}

export async function finalizeFailedBillsPayPayment(params: {
  supabaseAdmin: SupabaseClient;
  paymentProvider: string;
  paymentReference: string;
  externalTransactionId?: string | null;
  raw: Record<string, unknown>;
  failureReason?: string | null;
}) {
  const { supabaseAdmin } = params;

  const { data: payment, error: paymentLookupError } = await supabaseAdmin
    .from("bills_pay_payments")
    .select(`
      id,
      order_id,
      status,
      bills_pay_orders:order_id (
        id,
        status,
        payment_status
      )
    `)
    .eq("payment_provider", params.paymentProvider)
    .eq("payment_reference", params.paymentReference)
    .maybeSingle();

  if (paymentLookupError) {
    throw new Error("Unable to look up bills-pay payment reference.");
  }

  if (!payment) {
    throw new Error("Bills-pay payment reference was not found.");
  }

  const order = Array.isArray((payment as any).bills_pay_orders)
    ? (payment as any).bills_pay_orders[0] ?? null
    : (payment as any).bills_pay_orders ?? null;

  if (!order?.id) {
    throw new Error("Bills-pay order linked to the payment was not found.");
  }

  const nowIso = new Date().toISOString();

  const { error: paymentUpdateError } = await supabaseAdmin
    .from("bills_pay_payments")
    .update({
      status: "failed",
      external_transaction_id: readString(params.externalTransactionId) ?? null,
      verification_payload: {
        source: "payment_webhook",
        failedAt: nowIso,
        reason: readString(params.failureReason),
        raw: params.raw,
      },
      webhook_payload: params.raw,
    })
    .eq("id", payment.id);

  if (paymentUpdateError) {
    throw new Error("Unable to update failed bills-pay payment.");
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("bills_pay_orders")
    .update({
      status: "payment_failed",
      payment_status: "failed",
      payment_provider: params.paymentProvider,
      payment_reference: params.paymentReference,
      failed_at: nowIso,
      failure_code: "payment_failed",
      failure_message:
        readString(params.failureReason) ?? "Payment verification failed.",
    })
    .eq("id", order.id)
    .neq("payment_status", "verified");

  if (orderUpdateError) {
    throw new Error("Unable to update bills-pay order failure state.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("bills_pay_order_events")
    .insert({
      order_id: order.id,
      actor_type: "payment_provider",
      event_type: "payment_failed",
      message: "Payment failed server-side verification.",
      payload: {
        paymentProvider: params.paymentProvider,
        paymentReference: params.paymentReference,
        reason: readString(params.failureReason),
      },
    });

  if (eventError) {
    console.error("finalizeFailedBillsPayPayment event insert error:", eventError);
  }

  return {
    payment,
    order: {
      ...order,
      status: "payment_failed",
      payment_status: "failed",
    },
  };
}

export async function handleNormalizedBillsPayPaymentWebhook(params: {
  supabaseAdmin: SupabaseClient;
  event: NormalizedBillsPayPaymentWebhookEvent;
}) {
  if (params.event.eventType === "payment_verified") {
    return finalizeVerifiedBillsPayPayment({
      supabaseAdmin: params.supabaseAdmin,
      paymentProvider: params.event.paymentProvider,
      paymentReference: params.event.paymentReference,
      externalTransactionId: params.event.externalTransactionId,
      amount: params.event.amount,
      currency: params.event.currency,
      raw: params.event.raw,
    });
  }

  return finalizeFailedBillsPayPayment({
    supabaseAdmin: params.supabaseAdmin,
    paymentProvider: params.event.paymentProvider,
    paymentReference: params.event.paymentReference,
    externalTransactionId: params.event.externalTransactionId,
    raw: params.event.raw,
    failureReason:
      params.event.eventType === "payment_reversed"
        ? "Payment was reversed."
        : "Payment failed.",
  });
}
