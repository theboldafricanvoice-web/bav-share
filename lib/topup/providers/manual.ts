import type {
  FulfillmentStatusResult,
  NormalizedTopupProduct,
  PurchaseBundleInput,
  PurchaseBundleResult,
  TopupAggregatorAdapter,
  TopupCatalogFilter,
} from "@/lib/topup/providers/base";

export const manualTopupAggregatorAdapter: TopupAggregatorAdapter = {
  providerCode: "manual",
  async listProducts(_filter: TopupCatalogFilter): Promise<NormalizedTopupProduct[]> {
    return [];
  },
  async purchaseBundle(
    input: PurchaseBundleInput
  ): Promise<PurchaseBundleResult> {
    return {
      accepted: true,
      providerTransactionRef: `MANUAL-${input.providerRequestRef}`,
      providerStatus: "delivered",
      providerMessage:
        "Manual demo adapter marked the bundle as delivered immediately.",
      raw: {
        adapter: "manual",
        orderRef: input.orderRef,
        providerRequestRef: input.providerRequestRef,
        deliveryMode: "immediate_demo",
      },
    };
  },
  async getFulfillmentStatus(
    providerTransactionRef: string
  ): Promise<FulfillmentStatusResult> {
    return {
      providerStatus: "delivered",
      providerRequestRef: null,
      providerTransactionRef,
      providerMessage: "Manual demo adapter treats the bundle as delivered.",
      raw: {
        adapter: "manual",
        providerTransactionRef,
        deliveryMode: "immediate_demo",
      },
    };
  },
  async parseWebhook(
    payload,
    _headers,
    _rawBody
  ): Promise<FulfillmentStatusResult | null> {
    if (!payload || typeof payload !== "object") return null;

    const maybe = payload as Record<string, unknown>;
    const eventType =
      typeof maybe.eventType === "string" ? maybe.eventType.trim().toLowerCase() : "";
    const providerRequestRef =
      typeof maybe.providerRequestRef === "string"
        ? maybe.providerRequestRef.trim()
        : null;
    const providerTransactionRef =
      typeof maybe.providerTransactionRef === "string"
        ? maybe.providerTransactionRef.trim()
        : null;

    const providerStatus =
      eventType === "delivered"
        ? "delivered"
        : eventType === "failed"
        ? "failed"
        : eventType === "pending"
        ? "pending"
        : eventType === "unknown"
        ? "unknown"
        : null;

    if (!providerStatus) return null;

    return {
      providerStatus,
      providerRequestRef,
      providerTransactionRef,
      providerMessage:
        typeof maybe.providerMessage === "string" ? maybe.providerMessage : null,
      raw: maybe,
    };
  },
};
