import type { SupabaseClient } from "@supabase/supabase-js";
import { getTopupAggregatorAdapter } from "@/lib/topup/providers/registry";
import type { FulfillmentStatusResult } from "@/lib/topup/providers/base";
import { isProcessingTopupState, isVerifiedTopupPaymentState } from "@/lib/topup/types";
import { buildIdempotencyKey, buildProviderRequestRef } from "@/lib/topup/utils";

type PurchaseContext = {
  providerId: string | null;
  providerCode: string;
  networkCode: string;
  providerProductCode: string;
  amount: number;
  currency: string;
  productId?: string | null;
  networkId?: string | null;
  productType?: string | null;
  displayName?: string | null;
  description?: string | null;
  faceValue?: number | null;
  retailPrice?: number | null;
  costPrice?: number | null;
  dataVolumeLabel?: string | null;
  validityLabel?: string | null;
  networkName?: string | null;
  countryCode?: string | null;
};

function readStringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value.trim()))
    ? Number(value.trim())
    : null;
}

function buildPurchaseContextFromSnapshot(params: {
  snapshot: Record<string, unknown>;
  order: {
    provider_id: string | null;
    country_code: string;
    currency: string;
    sale_amount: number;
  };
}): PurchaseContext | null {
  const { snapshot, order } = params;
  const providerCode = readStringValue(snapshot.providerCode) ?? "manual";
  const networkCode = readStringValue(snapshot.networkCode);
  const providerProductCode = readStringValue(snapshot.providerProductCode);

  if (!networkCode || !providerProductCode) {
    return null;
  }

  return {
    providerId: order.provider_id,
    providerCode,
    networkCode,
    providerProductCode,
    amount: Number(order.sale_amount),
    currency: order.currency,
    productId: readStringValue(snapshot.productId),
    networkId: readStringValue(snapshot.networkId),
    productType: readStringValue(snapshot.productType),
    displayName: readStringValue(snapshot.displayName),
    description: readStringValue(snapshot.description),
    faceValue: readNumberValue(snapshot.faceValue),
    retailPrice: readNumberValue(snapshot.retailPrice),
    costPrice: readNumberValue(snapshot.costPrice),
    dataVolumeLabel: readStringValue(snapshot.dataVolumeLabel),
    validityLabel: readStringValue(snapshot.validityLabel),
    networkName: readStringValue(snapshot.networkName),
    countryCode: readStringValue(snapshot.countryCode) ?? order.country_code,
  };
}

function buildPurchaseContextFromFallbackCandidate(
  value: unknown,
  order: {
    country_code: string;
    currency: string;
    sale_amount: number;
  }
): PurchaseContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const providerCode = readStringValue(snapshot.providerCode);
  const networkCode = readStringValue(snapshot.networkCode);
  const providerProductCode = readStringValue(snapshot.providerProductCode);
  const providerId = readStringValue(snapshot.providerId);

  if (!providerCode || !networkCode || !providerProductCode || !providerId) {
    return null;
  }

  return {
    providerId,
    providerCode,
    networkCode,
    providerProductCode,
    amount: readNumberValue(snapshot.retailPrice) ?? Number(order.sale_amount),
    currency: readStringValue(snapshot.currency) ?? order.currency,
    productId: readStringValue(snapshot.productId),
    networkId: readStringValue(snapshot.networkId),
    productType: readStringValue(snapshot.productType),
    displayName: readStringValue(snapshot.displayName),
    description: readStringValue(snapshot.description),
    faceValue: readNumberValue(snapshot.faceValue),
    retailPrice: readNumberValue(snapshot.retailPrice),
    costPrice: readNumberValue(snapshot.costPrice),
    dataVolumeLabel: readStringValue(snapshot.dataVolumeLabel),
    validityLabel: readStringValue(snapshot.validityLabel),
    networkName: readStringValue(snapshot.networkName),
    countryCode: readStringValue(snapshot.countryCode) ?? order.country_code,
  };
}

async function markFulfillmentAttemptFailed(params: {
  supabaseAdmin: SupabaseClient;
  attemptId: string;
  providerTransactionRef?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  raw: Record<string, unknown>;
}) {
  const { supabaseAdmin } = params;
  const nowIso = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("data_topup_fulfillment_attempts")
    .update({
      provider_transaction_ref: params.providerTransactionRef ?? null,
      response_payload: params.raw,
      status: "failed",
      failure_code: params.failureCode ?? "provider_failed",
      failure_message: params.failureMessage ?? "Provider reported fulfillment failure.",
      completed_at: nowIso,
    })
    .eq("id", params.attemptId);

  if (error) {
    throw new Error("Unable to update failed top-up fulfillment attempt.");
  }
}

export async function markOrderAsFulfillmentFailed(params: {
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
    .from("data_topup_orders")
    .update({
      status: "topup_failed",
      fulfillment_status: "provider_failed",
      failed_at: nowIso,
      failure_code: failureCode,
      failure_message: params.failureMessage,
      refund_status: "pending",
    })
    .eq("id", params.orderId);

  if (orderUpdateError) {
    throw new Error("Unable to mark top-up order as failed after fulfillment error.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("data_topup_order_events")
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
    console.error("markOrderAsFulfillmentFailed event insert error:", eventError);
  }
}

export async function cleanupStaleTopupOrders(params: {
  supabaseAdmin: SupabaseClient;
  olderThanMinutes?: number;
}) {
  const { supabaseAdmin } = params;
  const olderThanMinutes = Math.max(1, Math.floor(params.olderThanMinutes ?? 60));
  const beforeIso = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data: orders, error: ordersLookupError } = await supabaseAdmin
    .from("data_topup_orders")
    .select(`
      id,
      order_ref,
      status,
      payment_status,
      fulfillment_status,
      created_at
    `)
    .eq("payment_status", "verified")
    .in("status", ["processing_topup", "payment_verified", "paid"])
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: true });

  if (ordersLookupError) {
    throw new Error("Unable to load stale top-up orders for cleanup.");
  }

  const summary = {
    olderThanMinutes,
    beforeIso,
    candidatesFound: (orders ?? []).length,
    reconciled: [] as string[],
    failed: [] as string[],
    skipped: [] as string[],
  };

  for (const order of orders ?? []) {
    const orderId = String((order as Record<string, unknown>).id ?? "");
    const orderRef = String((order as Record<string, unknown>).order_ref ?? orderId);

    const { data: attempts, error: attemptsLookupError } = await supabaseAdmin
      .from("data_topup_fulfillment_attempts")
      .select(`
        id,
        provider_request_ref,
        provider_transaction_ref,
        status
      `)
      .eq("order_id", orderId)
      .order("attempt_no", { ascending: false });

    if (attemptsLookupError) {
      summary.skipped.push(`${orderRef}: unable to inspect fulfillment attempts.`);
      continue;
    }

    const hasReconcilableAttempt = (attempts ?? []).some((attempt) => {
      const attemptStatus = String((attempt as Record<string, unknown>).status ?? "");
      const providerRequestRef = readStringValue(
        (attempt as Record<string, unknown>).provider_request_ref
      );
      const providerTransactionRef = readStringValue(
        (attempt as Record<string, unknown>).provider_transaction_ref
      );

      return (
        ["accepted", "submitted", "unknown"].includes(attemptStatus) &&
        Boolean(providerRequestRef || providerTransactionRef)
      );
    });

    if (hasReconcilableAttempt) {
      try {
        const reconciliationResult = await reconcileTopupFulfillmentAttempt({
          supabaseAdmin,
          orderId,
        });

        if (reconciliationResult.ok) {
          summary.reconciled.push(orderRef);
          continue;
        }
      } catch (error) {
        console.error("cleanupStaleTopupOrders reconciliation error:", {
          orderRef,
          error,
        });
      }
    }

    await markOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId,
      failureCode: "stale_processing_cleanup",
      failureMessage:
        "This top-up order was cleaned up after remaining stuck in processing without a completed provider result.",
      payload: {
        cleanupReason: "stale_processing_cleanup",
        olderThanMinutes,
      },
    });

    summary.failed.push(orderRef);
  }

  return summary;
}

export async function queueTopupOrderForFulfillment(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  source: "payment_webhook" | "payment_reconciliation" | "admin";
}) {
  const { supabaseAdmin, orderId, source } = params;

  const { data: order, error: orderLookupError } = await supabaseAdmin
    .from("data_topup_orders")
    .select("id, order_ref, status, payment_status, fulfillment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderLookupError) {
    throw new Error("Unable to load top-up order for fulfillment queueing.");
  }

  if (!order) {
    throw new Error("Top-up order was not found for fulfillment queueing.");
  }

  if (order.fulfillment_status === "queued" || order.status === "fulfillment_queued" || order.status === "processing_topup") {
    return {
      order,
      alreadyQueued: true,
    };
  }

  if (order.payment_status !== "verified" && !isVerifiedTopupPaymentState(order.status)) {
    throw new Error("Only payment-verified top-up orders can be queued for fulfillment.");
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("data_topup_orders")
    .update({
      status: "processing_topup",
      fulfillment_status: "queued",
    })
    .eq("id", orderId);

  if (orderUpdateError) {
    throw new Error("Unable to queue top-up order for fulfillment.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("data_topup_order_events")
    .insert({
      order_id: orderId,
      actor_type: "system",
      event_type: "fulfillment_queued",
      message: "Top-up order was queued for fulfillment after payment verification.",
      payload: {
        source,
      },
    });

  if (eventError) {
    console.error("queueTopupOrderForFulfillment event insert error:", eventError);
  }

  return {
    order: {
      ...order,
      status: "processing_topup",
      fulfillment_status: "queued",
    },
    alreadyQueued: false,
  };
}

function mapProviderStatusToOrderStatus(
  providerStatus: "accepted" | "pending" | "delivered" | "failed" | "unknown"
) {
  if (providerStatus === "delivered") {
    return {
      status: "topup_successful",
      fulfillment_status: "delivered",
    } as const;
  }

  if (providerStatus === "failed") {
    return {
      status: "topup_failed",
      fulfillment_status: "provider_failed",
    } as const;
  }

  return {
    status: "processing_topup",
    fulfillment_status: "in_progress",
  } as const;
}

async function applyFulfillmentStatusToAttemptAndOrder(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  attemptId: string;
  providerStatusResult: FulfillmentStatusResult;
}) {
  const { supabaseAdmin, orderId, attemptId, providerStatusResult } = params;
  const nowIso = new Date().toISOString();

  const mappedStatus = mapProviderStatusToOrderStatus(
    providerStatusResult.providerStatus
  );

  const { error: attemptUpdateError } = await supabaseAdmin
    .from("data_topup_fulfillment_attempts")
    .update({
      provider_transaction_ref: providerStatusResult.providerTransactionRef ?? null,
      response_payload: providerStatusResult.raw,
      status:
        providerStatusResult.providerStatus === "pending"
          ? "submitted"
          : providerStatusResult.providerStatus === "delivered"
          ? "delivered"
          : providerStatusResult.providerStatus === "failed"
          ? "failed"
          : "unknown",
      failure_message:
        providerStatusResult.providerStatus === "failed"
          ? providerStatusResult.providerMessage ??
            "Provider reported fulfillment failure."
          : null,
      completed_at:
        providerStatusResult.providerStatus === "delivered" ||
        providerStatusResult.providerStatus === "failed"
          ? nowIso
          : null,
    })
    .eq("id", attemptId);

  if (attemptUpdateError) {
    throw new Error("Unable to update top-up fulfillment attempt status.");
  }

  const orderUpdatePayload: Record<string, unknown> = {
    status: mappedStatus.status,
    fulfillment_status: mappedStatus.fulfillment_status,
  };

  if (mappedStatus.status === "topup_successful") {
    orderUpdatePayload.fulfilled_at = nowIso;
  }

  if (mappedStatus.status === "topup_failed") {
    orderUpdatePayload.failed_at = nowIso;
    orderUpdatePayload.failure_code = "provider_failed";
    orderUpdatePayload.failure_message =
      providerStatusResult.providerMessage ??
      "Provider reported fulfillment failure.";
    orderUpdatePayload.refund_status = "pending";
  }

  if (providerStatusResult.providerTransactionRef) {
    orderUpdatePayload.provider_reference =
      providerStatusResult.providerTransactionRef;
    orderUpdatePayload.aggregator_transaction_id =
      providerStatusResult.providerTransactionRef;
  }

  const { error: orderUpdateError } = await supabaseAdmin
    .from("data_topup_orders")
    .update(orderUpdatePayload)
    .eq("id", orderId);

  if (orderUpdateError) {
    throw new Error("Unable to update top-up order after fulfillment status change.");
  }

  const { error: eventError } = await supabaseAdmin
    .from("data_topup_order_events")
    .insert({
      order_id: orderId,
      actor_type: "provider",
      event_type: "fulfillment_status_updated",
      message:
        providerStatusResult.providerMessage ??
        "Provider fulfillment status was updated.",
      payload: {
        providerStatus: providerStatusResult.providerStatus,
        providerRequestRef: providerStatusResult.providerRequestRef ?? null,
        providerTransactionRef: providerStatusResult.providerTransactionRef ?? null,
      },
    });

  if (eventError) {
    console.error("applyFulfillmentStatusToAttemptAndOrder event insert error:", eventError);
  }

  return mappedStatus;
}

export async function executeQueuedTopupOrder(params: {
  supabaseAdmin: SupabaseClient;
  orderId?: string;
}) {
  const { supabaseAdmin } = params;

  let order: 
    | {
        id: string;
        order_ref: string;
        provider_id: string | null;
        recipient_msisdn: string;
        country_code: string;
        currency: string;
        sale_amount: number;
        status: string;
        payment_status: string;
        fulfillment_status: string;
        locked_product_snapshot: Record<string, unknown>;
      }
    | undefined;

  try {
    let orderQuery = supabaseAdmin
      .from("data_topup_orders")
      .select(`
        id,
        order_ref,
        provider_id,
        recipient_msisdn,
        country_code,
        currency,
        sale_amount,
        status,
        payment_status,
        fulfillment_status,
        locked_product_snapshot
      `)
      .in("status", ["fulfillment_queued", "processing_topup", "payment_verified", "paid"])
      .eq("payment_status", "verified")
      .order("created_at", { ascending: true })
      .limit(1);

    if (params.orderId) {
      orderQuery = orderQuery.eq("id", params.orderId);
    }

    const { data: orders, error: orderLookupError } = await orderQuery;

    if (orderLookupError) {
      throw new Error("Unable to load queued top-up order.");
    }

    order = (orders ?? [])[0] as typeof order | undefined;

    if (!order) {
      return {
        ok: false as const,
        reason: "No queued top-up order was available.",
      };
    }

    const currentOrder = order;

    if (
      isProcessingTopupState(currentOrder.status) &&
      currentOrder.fulfillment_status === "in_progress"
    ) {
      return {
        ok: false as const,
        reason: "Top-up order is already being processed.",
      };
    }

    const snapshot = currentOrder.locked_product_snapshot ?? {};
    const primaryContext = buildPurchaseContextFromSnapshot({
      snapshot,
      order: currentOrder,
    });
    const fallbackContexts = Array.isArray(snapshot.fallbackCandidates)
      ? snapshot.fallbackCandidates
          .map((value) => buildPurchaseContextFromFallbackCandidate(value, currentOrder))
          .filter((value): value is PurchaseContext => Boolean(value))
      : [];
    const purchaseContexts = [primaryContext, ...fallbackContexts].filter(
      (value): value is PurchaseContext => Boolean(value)
    );

    if (purchaseContexts.length === 0) {
      await markOrderAsFulfillmentFailed({
        supabaseAdmin,
        orderId: currentOrder.id,
        failureCode: "invalid_provider_snapshot",
        failureMessage:
          "Queued top-up order is missing required provider snapshot fields.",
      });

      throw new Error("Queued top-up order is missing required provider snapshot fields.");
    }

    const { data: existingAttempts, error: attemptsLookupError } = await supabaseAdmin
      .from("data_topup_fulfillment_attempts")
      .select("id, attempt_no")
      .eq("order_id", currentOrder.id)
      .order("attempt_no", { ascending: false })
      .limit(1);

    if (attemptsLookupError) {
      throw new Error("Unable to load prior top-up fulfillment attempts.");
    }

    const lastAttemptNo = Number((existingAttempts ?? [])[0]?.attempt_no ?? 0);
    let nextAttemptNo = lastAttemptNo + 1;

    for (let index = 0; index < purchaseContexts.length; index += 1) {
      const context = purchaseContexts[index];
      const isLastContext = index === purchaseContexts.length - 1;
      const adapter = getTopupAggregatorAdapter(context.providerCode);

      if (!adapter) {
        if (isLastContext) {
          await markOrderAsFulfillmentFailed({
            supabaseAdmin,
            orderId: order.id,
            failureCode: "provider_not_configured",
            failureMessage: `No top-up aggregator adapter is configured for ${context.providerCode}.`,
            payload: {
              providerCode: context.providerCode,
            },
          });
          throw new Error(
            `No top-up aggregator adapter is configured for ${context.providerCode}.`
          );
        }
        continue;
      }

      if (!context.providerId) {
        if (isLastContext) {
          await markOrderAsFulfillmentFailed({
            supabaseAdmin,
            orderId: order.id,
            failureCode: "provider_missing_id",
            failureMessage: `Top-up fallback provider ${context.providerCode} is missing a provider id.`,
            payload: {
              providerCode: context.providerCode,
            },
          });
          throw new Error(
            `Top-up fallback provider ${context.providerCode} is missing a provider id.`
          );
        }
        continue;
      }

      const attemptNo = nextAttemptNo;
      nextAttemptNo += 1;
      const providerRequestRef = buildProviderRequestRef();
      const idempotencyKey = buildIdempotencyKey(
        `topup-${order.id}-${context.providerCode}-${attemptNo}`
      );

      const { data: attempt, error: attemptInsertError } = await supabaseAdmin
        .from("data_topup_fulfillment_attempts")
        .insert({
          order_id: order.id,
          provider_id: context.providerId,
          attempt_no: attemptNo,
          idempotency_key: idempotencyKey,
          provider_request_ref: providerRequestRef,
          request_payload: {
            providerCode: context.providerCode,
            orderRef: order.order_ref,
            recipientMsisdn: order.recipient_msisdn,
            countryCode: context.countryCode ?? order.country_code,
            networkCode: context.networkCode,
            providerProductCode: context.providerProductCode,
            amount: context.amount,
            currency: context.currency,
          },
          status: "queued",
        })
        .select("id, attempt_no, provider_request_ref")
        .single();

      if (attemptInsertError || !attempt) {
        throw new Error("Unable to create top-up fulfillment attempt.");
      }

      try {
        const purchaseResult = await adapter.purchaseBundle({
          orderRef: order.order_ref,
          providerRequestRef,
          recipientMsisdn: order.recipient_msisdn,
          countryCode: context.countryCode ?? order.country_code,
          networkCode: context.networkCode,
          providerProductCode: context.providerProductCode,
          amount: Number(context.amount),
          currency: context.currency,
        });

        if (purchaseResult.providerStatus === "failed" && !isLastContext) {
          await markFulfillmentAttemptFailed({
            supabaseAdmin,
            attemptId: attempt.id,
            providerTransactionRef: purchaseResult.providerTransactionRef ?? null,
            failureCode: "provider_failed",
            failureMessage:
              purchaseResult.providerMessage ??
              `Provider ${context.providerCode} failed before fallback.`,
            raw: purchaseResult.raw,
          });

          const { error: fallbackEventError } = await supabaseAdmin
            .from("data_topup_order_events")
            .insert({
              order_id: order.id,
              actor_type: "system",
              event_type: "fulfillment_fallback_triggered",
              message:
                purchaseResult.providerMessage ??
                `Falling back after ${context.providerCode} fulfillment failure.`,
              payload: {
                attemptNo,
                providerCode: context.providerCode,
                providerRequestRef,
                providerTransactionRef: purchaseResult.providerTransactionRef ?? null,
                nextProviderCode: purchaseContexts[index + 1]?.providerCode ?? null,
              },
            });

          if (fallbackEventError) {
            console.error(
              "executeQueuedTopupOrder fallback event insert error:",
              fallbackEventError
            );
          }

          continue;
        }

        const mappedStatus = await applyFulfillmentStatusToAttemptAndOrder({
          supabaseAdmin,
          orderId: order.id,
          attemptId: attempt.id,
          providerStatusResult: {
            providerStatus:
              purchaseResult.providerStatus === "accepted"
                ? "pending"
                : purchaseResult.providerStatus,
            providerRequestRef,
            providerTransactionRef: purchaseResult.providerTransactionRef ?? null,
            providerMessage: purchaseResult.providerMessage ?? null,
            raw: purchaseResult.raw,
          },
        });

        const { error: eventError } = await supabaseAdmin
          .from("data_topup_order_events")
          .insert({
            order_id: order.id,
            actor_type: "system",
            event_type: "fulfillment_submitted",
            message:
              purchaseResult.providerMessage ??
              "Top-up fulfillment request was sent to the provider.",
            payload: {
              attemptNo,
              providerCode: context.providerCode,
              providerRequestRef,
              providerTransactionRef: purchaseResult.providerTransactionRef ?? null,
              providerStatus: purchaseResult.providerStatus,
            },
          });

        if (eventError) {
          console.error("executeQueuedTopupOrder event insert error:", eventError);
        }

        return {
          ok: true as const,
          orderId: order.id,
          orderRef: order.order_ref,
          attemptId: attempt.id,
          attemptNo,
          providerCode: context.providerCode,
          providerStatus: purchaseResult.providerStatus,
          fulfillmentStatus: mappedStatus.fulfillment_status,
        };
      } catch (error) {
        if (!isLastContext) {
          await markFulfillmentAttemptFailed({
            supabaseAdmin,
            attemptId: attempt.id,
            failureCode: "provider_error",
            failureMessage:
              error instanceof Error
                ? error.message
                : `Provider ${context.providerCode} threw an unknown error.`,
            raw: {
              providerCode: context.providerCode,
              error: error instanceof Error ? error.message : "Unknown provider error",
            },
          });

          const { error: fallbackEventError } = await supabaseAdmin
            .from("data_topup_order_events")
            .insert({
              order_id: order.id,
              actor_type: "system",
              event_type: "fulfillment_fallback_triggered",
              message:
                error instanceof Error
                  ? error.message
                  : `Falling back after ${context.providerCode} error.`,
              payload: {
                attemptNo,
                providerCode: context.providerCode,
                providerRequestRef,
                nextProviderCode: purchaseContexts[index + 1]?.providerCode ?? null,
              },
            });

          if (fallbackEventError) {
            console.error(
              "executeQueuedTopupOrder fallback error event insert error:",
              fallbackEventError
            );
          }

          continue;
        }

        throw error;
      }
    }

    await markOrderAsFulfillmentFailed({
      supabaseAdmin,
      orderId: order.id,
      failureCode: "no_provider_accepted",
      failureMessage: "No top-up provider was able to accept this fulfillment request.",
      payload: {
        providerCodesTried: purchaseContexts.map((context) => context.providerCode),
      },
    });

    throw new Error("No top-up provider was able to accept this fulfillment request.");
  } catch (error) {
    if (order?.id) {
      await markOrderAsFulfillmentFailed({
        supabaseAdmin,
        orderId: order.id,
        failureCode: "fulfillment_dispatch_error",
        failureMessage:
          error instanceof Error
            ? error.message
            : "Unhandled fulfillment dispatch error.",
        payload: {
          orderRef: order.order_ref,
        },
      }).catch((markError) => {
        console.error("executeQueuedTopupOrder final failure marking error:", markError);
      });
    }

    throw error;
  }
}

export async function reconcileTopupFulfillmentAttempt(params: {
  supabaseAdmin: SupabaseClient;
  orderId?: string;
  providerRequestRef?: string;
  providerTransactionRef?: string;
}) {
  const { supabaseAdmin } = params;

  let attemptQuery = supabaseAdmin
    .from("data_topup_fulfillment_attempts")
    .select(`
      id,
      order_id,
      provider_request_ref,
      provider_transaction_ref,
      status,
      request_payload,
      data_topup_orders:order_id (
        id,
        provider_id,
        status,
        payment_status,
        fulfillment_status,
        locked_product_snapshot
      )
    `)
    .in("status", ["accepted", "submitted", "unknown"]);

  if (params.orderId) {
    attemptQuery = attemptQuery.eq("order_id", params.orderId);
  }

  if (params.providerRequestRef) {
    attemptQuery = attemptQuery.eq("provider_request_ref", params.providerRequestRef);
  }

  if (params.providerTransactionRef) {
    attemptQuery = attemptQuery.eq(
      "provider_transaction_ref",
      params.providerTransactionRef
    );
  }

  const { data: attempts, error: attemptLookupError } = await attemptQuery
    .order("started_at", { ascending: true })
    .limit(1);

  if (attemptLookupError) {
    throw new Error("Unable to load top-up fulfillment attempt for reconciliation.");
  }

  const attempt = (attempts ?? [])[0] as
    | {
        id: string;
        order_id: string;
        provider_request_ref: string;
        provider_transaction_ref: string | null;
        status: string;
        request_payload: Record<string, unknown>;
        data_topup_orders:
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null;
      }
    | undefined;

  if (!attempt) {
    return {
      ok: false as const,
      reason: "No reconcilable top-up fulfillment attempt was found.",
    };
  }

  const order = Array.isArray(attempt.data_topup_orders)
    ? attempt.data_topup_orders[0] ?? null
    : attempt.data_topup_orders ?? null;

  if (!order) {
    throw new Error("Top-up order linked to the fulfillment attempt was not found.");
  }

  const snapshot =
    typeof order.locked_product_snapshot === "object" &&
    order.locked_product_snapshot !== null
      ? (order.locked_product_snapshot as Record<string, unknown>)
      : {};
  const requestPayload =
    typeof attempt.request_payload === "object" && attempt.request_payload !== null
      ? attempt.request_payload
      : {};
  const providerCode =
    typeof snapshot.providerCode === "string"
      ? snapshot.providerCode
      : typeof requestPayload.providerCode === "string"
      ? requestPayload.providerCode
      : "manual";

  const adapter = getTopupAggregatorAdapter(providerCode);
  if (!adapter) {
    throw new Error(`No top-up aggregator adapter is configured for ${providerCode}.`);
  }

  const providerTransactionRef =
    attempt.provider_transaction_ref ??
    (typeof requestPayload.providerTransactionRef === "string"
      ? requestPayload.providerTransactionRef
      : null);

  if (!providerTransactionRef) {
    return {
      ok: false as const,
      reason: "Fulfillment attempt has no provider transaction reference to reconcile.",
    };
  }

  const statusResult = await adapter.getFulfillmentStatus(providerTransactionRef);
  const mappedStatus = await applyFulfillmentStatusToAttemptAndOrder({
    supabaseAdmin,
    orderId: attempt.order_id,
    attemptId: attempt.id,
    providerStatusResult: {
      ...statusResult,
      providerRequestRef:
        statusResult.providerRequestRef ?? attempt.provider_request_ref,
    },
  });

  return {
    ok: true as const,
    orderId: attempt.order_id,
    attemptId: attempt.id,
    providerCode,
    providerStatus: statusResult.providerStatus,
    fulfillmentStatus: mappedStatus.fulfillment_status,
  };
}

export async function applyTopupFulfillmentWebhook(params: {
  supabaseAdmin: SupabaseClient;
  providerCode: string;
  providerStatusResult: FulfillmentStatusResult;
}) {
  const { supabaseAdmin, providerCode, providerStatusResult } = params;

  const providerRequestRef = providerStatusResult.providerRequestRef ?? null;
  const providerTransactionRef = providerStatusResult.providerTransactionRef ?? null;

  if (!providerRequestRef && !providerTransactionRef) {
    throw new Error(
      "Fulfillment webhook must include providerRequestRef or providerTransactionRef."
    );
  }

  let attemptQuery = supabaseAdmin
    .from("data_topup_fulfillment_attempts")
    .select("id, order_id, provider_request_ref, provider_transaction_ref")
    .order("started_at", { ascending: false })
    .limit(1);

  if (providerRequestRef) {
    attemptQuery = attemptQuery.eq("provider_request_ref", providerRequestRef);
  } else if (providerTransactionRef) {
    attemptQuery = attemptQuery.eq("provider_transaction_ref", providerTransactionRef);
  }

  const { data: attempts, error: attemptLookupError } = await attemptQuery;

  if (attemptLookupError) {
    throw new Error("Unable to look up top-up fulfillment attempt from webhook.");
  }

  const attempt = (attempts ?? [])[0] as
    | {
        id: string;
        order_id: string;
        provider_request_ref: string;
        provider_transaction_ref: string | null;
      }
    | undefined;

  if (!attempt) {
    throw new Error(
      `No top-up fulfillment attempt matched provider callback for ${providerCode}.`
    );
  }

  const mappedStatus = await applyFulfillmentStatusToAttemptAndOrder({
    supabaseAdmin,
    orderId: attempt.order_id,
    attemptId: attempt.id,
    providerStatusResult: {
      ...providerStatusResult,
      providerRequestRef:
        providerStatusResult.providerRequestRef ?? attempt.provider_request_ref,
      providerTransactionRef:
        providerStatusResult.providerTransactionRef ??
        attempt.provider_transaction_ref,
    },
  });

  return {
    ok: true as const,
    orderId: attempt.order_id,
    attemptId: attempt.id,
    providerCode,
    providerStatus: providerStatusResult.providerStatus,
    fulfillmentStatus: mappedStatus.fulfillment_status,
  };
}
