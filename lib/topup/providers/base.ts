export type TopupCatalogFilter = {
  countryCode: string;
  networkCode?: string;
};

export type NormalizedTopupProduct = {
  providerCode: string;
  countryCode: string;
  networkCode: string;
  providerProductCode: string;
  displayName: string;
  description?: string | null;
  currency: string;
  faceValue: number;
  retailPrice: number;
  costPrice?: number | null;
  dataVolumeLabel?: string | null;
  validityLabel?: string | null;
  metadata?: Record<string, unknown>;
};

export type PurchaseBundleInput = {
  orderRef: string;
  providerRequestRef: string;
  recipientMsisdn: string;
  countryCode: string;
  networkCode: string;
  providerProductCode: string;
  amount: number;
  currency: string;
};

export type PurchaseBundleResult = {
  accepted: boolean;
  providerTransactionRef?: string | null;
  providerStatus: "accepted" | "pending" | "delivered" | "failed" | "unknown";
  providerMessage?: string | null;
  raw: Record<string, unknown>;
};

export type FulfillmentStatusResult = {
  providerStatus: "pending" | "delivered" | "failed" | "unknown";
  providerRequestRef?: string | null;
  providerTransactionRef?: string | null;
  providerMessage?: string | null;
  raw: Record<string, unknown>;
};

export interface TopupAggregatorAdapter {
  providerCode: string;
  listProducts(filter: TopupCatalogFilter): Promise<NormalizedTopupProduct[]>;
  purchaseBundle(input: PurchaseBundleInput): Promise<PurchaseBundleResult>;
  getFulfillmentStatus(
    providerTransactionRef: string
  ): Promise<FulfillmentStatusResult>;
  parseWebhook?(
    payload: unknown,
    headers: Headers,
    rawBody?: string
  ): Promise<FulfillmentStatusResult | null>;
}
