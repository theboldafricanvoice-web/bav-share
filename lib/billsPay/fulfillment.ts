import type { SupabaseClient } from "@supabase/supabase-js";
import { getBillsPayProviderAdapter } from "@/lib/billsPay/providers/registry";
import type { BillPaymentStatusResult } from "@/lib/billsPay/providers/base";
import {
  buildBillsPayIdempotencyKey,
  buildBillsPayProviderRequestRef,
} from "@/lib/billsPay/utils";

function readStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapProviderStatusToOrderStatus(
  providerStatus: "accepted" | "pending" | "paid_to_biller" | "failed" | "unknown"
) {
  if (providerStatus === "paid_to_biller") {
    return {
      status: "bill_payment_successful",
      fulfillment_status: "paid_to_biller",
    } as const;
  }

  if (providerStatus === "failed") {
    return {
      status: "bill_payment_failed",
      fulfillment_status: "provider_failed",
    } as const;
  }

  return {
    status: "processing_bill_payment",
    fulfillment_status: "in_progress",
  } as const;
}

export async function markBillsPayOrderAsFulfillmentFailed(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  failureMessage: string;
  failureCode?: string | null;
  payload?: Record<string, unknown>;
}) {
  const { supabaseAdmin } = params;
  const nowIso = new Date().toISOString();
  const failureCode = params.failureCode ?? "provider_failed";

  const { error: orderUpdateError } = await supabaseAdmin
    .from("bills_pay_orders")
    .update({
      status: "bill_payment_failed",
      fulfillment_status: "provider_failed",
      failed_at: nowIso,
      failure_code: failureCode,
      failure_message: params.failureMessage,
      refund_status: "pending",
    })
    .eq("id", params.orderId);

  if (orderUpdateError) {
    throw new Error("Unable to mark bills-pay order as failed after fulfillment error.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("bills_pay_order_events")
    .insert({
      order_id: params.orderId,
      actor_type: "system",
      event_type: "fulfillment_failed",
      message: params.failureMessage,
      payload: {
        failureCode,
        ...(params.payload ?? {}),
      },
    });

  if (eventError) {
    console.error("markBillsPayOrderAsFulfillmentFailed event insert error:", eventError);
  }
}

export async function queueBillsPayOrderForFulfillment(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  source: "payment_webhook" | "manual_confirmation" | "admin";
}) {
  const { supabaseAdmin, orderId, source } = params;

  const { data: order, error: orderLookupError } = await supabaseAdmin
    .from("bills_pay_orders")
    .select("id, order_ref, status, payment_status, fulfillment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderLookupError) {
    throw new Error("Unable to load bills-pay order for fulfillment queueing.");
  }

  if (!order) {
    throw new Error("Bills-pay order was not found for fulfillment queueing.");
  }

  if (
    order.fulfillment_status === "queued" ||
    order.status === "processing_bill_payment"
  ) {
    return {
      order,
      alreadyQueued: true,
    };
  }

  if (order.payment_status !== "verified" && order.status !== "payment_verified") {
    throw new Error("Only payment-verified bills-pay orders can be queued for fulfillment.");
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("bills_pay_orders")
    .update({
      status: "processing_bill_payment",
      fulfillment_status: "queued",
    })
    .eq("id", orderId);

  if (orderUpdateError) {
    throw new Error("Unable to queue bills-pay order for fulfillment.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("bills_pay_order_events")
    .insert({
      order_id: orderId,
      actor_type: "system",
      event_type: "fulfillment_queued",
      message: "Bills-pay order was queued for provider fulfillment after payment verification.",
      payload: {
        source,
      },
    });

  if (eventError) {
    console.error("queueBillsPayOrderForFulfillment event insert error:", eventError);
  }

  return {
    order: {
      ...order,
      status: "processing_bill_payment",
      fulfillment_status: "queued",
    },
    alreadyQueued: false,
  };
}

async function applyBillsPayFulfillmentStatus(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  attemptId: string;
  providerStatusResult: BillPaymentStatusResult;
}) {
  const { supabaseAdmin, orderId, attemptId, providerStatusResult } = params;
  const nowIso = new Date().toISOString();
  const mappedStatus = mapProviderStatusToOrderStatus(providerStatusResult.providerStatus);

  const { error: attemptUpdateError } = await supabaseAdmin
    .from("bills_pay_fulfillment_attempts")
    .update({
      provider_transaction_ref: providerStatusResult.providerTransactionRef ?? null,
      response_payload: providerStatusResult.raw,
      status:
        providerStatusResult.providerStatus === "pending"
          ? "submitted"
          : providerStatusResult.providerStatus === "paid_to_biller"
          ? "paid_to_biller"
          : providerStatusResult.providerStatus === "failed"
          ? "failed"
          : "unknown",
      failure_message:
        providerStatusResult.providerStatus === "failed"
          ? providerStatusResult.providerMessage ??
            "Provider reported a bills-pay fulfillment failure."
          : null,
      completed_at:
        providerStatusResult.providerStatus === "paid_to_biller" ||
        providerStatusResult.providerStatus === "failed"
          ? nowIso
          : null,
    })
    .eq("id", attemptId);

  if (attemptUpdateError) {
    throw new Error("Unable to update bills-pay fulfillment attempt status.");
  }

  const orderUpdatePayload: Record<string, unknown> = {
    status: mappedStatus.status,
    fulfillment_status: mappedStatus.fulfillment_status,
  };

  if (mappedStatus.status === "bill_payment_successful") {
    orderUpdatePayload.fulfilled_at = nowIso;
  }

  if (mappedStatus.status === "bill_payment_failed") {
    orderUpdatePayload.failed_at = nowIso;
    orderUpdatePayload.failure_code = "provider_failed";
    orderUpdatePayload.failure_message =
      providerStatusResult.providerMessage ??
      "Provider reported a bills-pay fulfillment failure.";
    orderUpdatePayload.refund_status = "pending";
  }

  if (providerStatusResult.providerTransactionRef) {
    orderUpdatePayload.aggregator_transaction_id =
      providerStatusResult.providerTransactionRef;
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("bills_pay_orders")
    .update(orderUpdatePayload)
    .eq("id", orderId);

  if (orderUpdateError) {
    throw new Error("Unable to update bills-pay order after fulfillment status change.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("bills_pay_order_events")
    .insert({
      order_id: orderId,
      actor_type: "provider",
      event_type: "fulfillment_status_updated",
      message:
        providerStatusResult.providerMessage ??
        "Provider bills-pay fulfillment status was updated.",
      payload: {
        providerStatus: providerStatusResult.providerStatus,
        providerRequestRef: providerStatusResult.providerRequestRef ?? null,
        providerTransactionRef: providerStatusResult.providerTransactionRef ?? null,
      },
    });

  if (eventError) {
    console.error("applyBillsPayFulfillmentStatus event insert error:", eventError);
  }

  return mappedStatus;
}

export async function executeQueuedBillsPayOrder(params: {
  supabaseAdmin: SupabaseClient;
  orderId?: string;
}) {
  const { supabaseAdmin } = params;

  const baseQuery = supabaseAdmin
    .from("bills_pay_orders")
    .select(`
      id,
      order_ref,
      provider_id,
      biller_id,
      country_code,
      customer_reference,
      account_number,
      meter_number,
      student_id,
      service_number,
      bill_amount,
      selling_price,
      currency,
      status,
      payment_status,
      fulfillment_status,
      locked_biller_snapshot,
      aggregator_provider
    `)
    .eq("payment_status", "verified")
    .in("status", ["payment_verified", "processing_bill_payment"])
    .order("created_at", { ascending: true })
    .limit(1);

  const query = params.orderId ? baseQuery.eq("id", params.orderId) : baseQuery;
  const { data: orders, error: orderLookupError } = await query;

  if (orderLookupError) {
    throw new Error("Unable to load queued bills-pay order.");
  }

  const order = (orders ?? [])[0] as
    | {
        id: string;
        order_ref: string;
        provider_id: string | null;
        biller_id: string;
        country_code: string;
        customer_reference: string | null;
        account_number: string | null;
        meter_number: string | null;
        student_id: string | null;
        service_number: string | null;
        bill_amount: number;
        selling_price: number;
        currency: string;
        status: string;
        payment_status: string;
        fulfillment_status: string;
        locked_biller_snapshot: Record<string, unknown>;
        aggregator_provider: string | null;
      }
    | undefined;

  if (!order) {
    return {
      ok: false as const,
      reason: "No queued bills-pay order was available.",
    };
  }

  const providerCode =
    readStringValue(order.aggregator_provider) ??
    readStringValue(order.locked_biller_snapshot?.providerCode) ??
    "manual";
  const billerCode = readStringValue(order.locked_biller_snapshot?.billerCode);
  const adapter = getBillsPayProviderAdapter(providerCode);

  if (!adapter) {
    await markBillsPayOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId: order.id,
      failureCode: "provider_not_configured",
      failureMessage: `No bills-pay provider adapter is configured for ${providerCode}.`,
      payload: {
        providerCode,
      },
    });

    throw new Error(`No bills-pay provider adapter is configured for ${providerCode}.`);
  }

  if (!order.provider_id || !billerCode) {
    await markBillsPayOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId: order.id,
      failureCode: "invalid_biller_snapshot",
      failureMessage: "Bills-pay order is missing the locked provider or biller reference.",
    });

    throw new Error("Bills-pay order is missing the locked provider or biller reference.");
  }

  const accountReference =
    readStringValue(order.customer_reference) ??
    readStringValue(order.account_number) ??
    readStringValue(order.meter_number) ??
    readStringValue(order.student_id) ??
    readStringValue(order.service_number);

  if (!accountReference) {
    await markBillsPayOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId: order.id,
      failureCode: "missing_customer_reference",
      failureMessage: "Bills-pay order is missing a customer account reference.",
    });

    throw new Error("Bills-pay order is missing a customer account reference.");
  }

  const { data: latestAttempts, error: attemptsLookupError } = await supabaseAdmin
    .from("bills_pay_fulfillment_attempts")
    .select("id, attempt_no")
    .eq("order_id", order.id)
    .order("attempt_no", { ascending: false })
    .limit(1);

  if (attemptsLookupError) {
    throw new Error("Unable to load prior bills-pay fulfillment attempts.");
  }

  const nextAttemptNo = Number((latestAttempts ?? [])[0]?.attempt_no ?? 0) + 1;
  const providerRequestRef = buildBillsPayProviderRequestRef();
  const idempotencyKey = buildBillsPayIdempotencyKey(
    `bill-${order.id}-${providerCode}-${nextAttemptNo}`
  );

  const { data: attempt, error: attemptInsertError } = await supabaseAdmin
    .from("bills_pay_fulfillment_attempts")
    .insert({
      order_id: order.id,
      provider_id: order.provider_id,
      attempt_no: nextAttemptNo,
      idempotency_key: idempotencyKey,
      provider_request_ref: providerRequestRef,
      request_payload: {
        providerCode,
        orderRef: order.order_ref,
        countryCode: order.country_code,
        billerCode,
        amount: Number(order.bill_amount),
        currency: order.currency,
        accountReference,
      },
      status: "queued",
    })
    .select("id, attempt_no, provider_request_ref")
    .single();

  if (attemptInsertError || !attempt) {
    throw new Error("Unable to create bills-pay fulfillment attempt.");
  }

  try {
    const paymentResult = await adapter.payBill({
      orderRef: order.order_ref,
      providerRequestRef,
      countryCode: order.country_code,
      billerCode,
      amount: Number(order.bill_amount),
      currency: order.currency,
      accountReference,
      fields: {
        ...(readStringValue(order.account_number)
          ? { account_number: readStringValue(order.account_number)! }
          : {}),
        ...(readStringValue(order.meter_number)
          ? { meter_number: readStringValue(order.meter_number)! }
          : {}),
        ...(readStringValue(order.student_id)
          ? { student_id: readStringValue(order.student_id)! }
          : {}),
        ...(readStringValue(order.service_number)
          ? { service_number: readStringValue(order.service_number)! }
          : {}),
      },
    });

    const mappedStatus = await applyBillsPayFulfillmentStatus({
      supabaseAdmin,
      orderId: order.id,
      attemptId: attempt.id,
      providerStatusResult: {
        providerStatus:
          paymentResult.providerStatus === "accepted"
            ? "pending"
            : paymentResult.providerStatus,
        providerRequestRef,
        providerTransactionRef: paymentResult.providerTransactionRef ?? null,
        providerMessage: paymentResult.providerMessage ?? null,
        raw: paymentResult.raw,
      },
    });

    const { error: eventError } = await supabaseAdmin
      .from("bills_pay_order_events")
      .insert({
        order_id: order.id,
        actor_type: "system",
        event_type: "fulfillment_submitted",
        message:
          paymentResult.providerMessage ??
          "Bills-pay fulfillment request was sent to the provider.",
        payload: {
          attemptNo: nextAttemptNo,
          providerCode,
          providerRequestRef,
          providerTransactionRef: paymentResult.providerTransactionRef ?? null,
          providerStatus: paymentResult.providerStatus,
        },
      });

    if (eventError) {
      console.error("executeQueuedBillsPayOrder event insert error:", eventError);
    }

    return {
      ok: true as const,
      orderId: order.id,
      orderRef: order.order_ref,
      attemptId: attempt.id,
      attemptNo: nextAttemptNo,
      providerCode,
      mappedStatus,
    };
  } catch (error) {
    const failureMessage =
      error instanceof Error
        ? error.message
        : "Bills-pay provider request failed before a result could be recorded.";

    const nowIso = new Date().toISOString();
    const { error: attemptUpdateError } = await supabaseAdmin
      .from("bills_pay_fulfillment_attempts")
      .update({
        status: "failed",
        failure_code: "provider_failed",
        failure_message: failureMessage,
        response_payload: {
          error: failureMessage,
        },
        completed_at: nowIso,
      })
      .eq("id", attempt.id);

    if (attemptUpdateError) {
      console.error(
        "executeQueuedBillsPayOrder failed attempt update error:",
        attemptUpdateError
      );
    }

    await markBillsPayOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId: order.id,
      failureCode: "provider_failed",
      failureMessage,
      payload: {
        providerCode,
        providerRequestRef,
      },
    });

    throw error;
  }
}

export async function reconcileBillsPayOrderFulfillment(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
}) {
  const { supabaseAdmin, orderId } = params;

  const { data: order, error: orderLookupError } = await supabaseAdmin
    .from("bills_pay_orders")
    .select("id, order_ref, aggregator_provider, status, fulfillment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderLookupError) {
    throw new Error("Unable to load bills-pay order for fulfillment reconciliation.");
  }

  if (!order) {
    throw new Error("Bills-pay order was not found for fulfillment reconciliation.");
  }

  if (
    order.status !== "processing_bill_payment" ||
    !["queued", "in_progress", "unknown"].includes(order.fulfillment_status)
  ) {
    return {
      ok: false as const,
      reason: "Bills-pay order is not awaiting provider reconciliation.",
    };
  }

  const providerCode = readStringValue(order.aggregator_provider) ?? "manual";
  const adapter = getBillsPayProviderAdapter(providerCode);

  if (!adapter) {
    throw new Error(`No bills-pay provider adapter is configured for ${providerCode}.`);
  }

  const { data: attempts, error: attemptsLookupError } = await supabaseAdmin
    .from("bills_pay_fulfillment_attempts")
    .select("id, provider_request_ref, provider_transaction_ref, status")
    .eq("order_id", orderId)
    .in("status", ["queued", "submitted", "accepted", "unknown"])
    .order("attempt_no", { ascending: false })
    .limit(1);

  if (attemptsLookupError) {
    throw new Error("Unable to load bills-pay fulfillment attempts for reconciliation.");
  }

  const attempt = (attempts ?? [])[0];
  const providerTransactionRef = readStringValue(attempt?.provider_transaction_ref);

  if (!attempt?.id || !providerTransactionRef) {
    return {
      ok: false as const,
      reason: "Bills-pay fulfillment attempt has no provider transaction reference to reconcile.",
    };
  }

  const statusResult = await adapter.checkTransactionStatus(providerTransactionRef);
  const mappedStatus = await applyBillsPayFulfillmentStatus({
    supabaseAdmin,
    orderId,
    attemptId: String(attempt.id),
    providerStatusResult: statusResult,
  });

  return {
    ok: true as const,
    orderId,
    orderRef: order.order_ref,
    providerCode,
    mappedStatus,
    providerStatus: statusResult.providerStatus,
  };
}
