import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FulfillmentStatusResult,
  PurchaseBundleInput,
  PurchaseBundleResult,
  TopupAggregatorAdapter,
} from "@/lib/topup/providers/base";

const DINGCONNECT_AUTH_URL = "https://idp.ding.com/connect/token";
const DINGCONNECT_API_BASE_URL = "https://api.dingconnect.com";

type DingConnectTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type DingConnectProvider = {
  ProviderCode?: string;
  CountryIso?: string;
  Name?: string;
  ShortName?: string;
  LogoUrl?: string;
  Status?: string;
  IsActive?: boolean;
  SupportsProducts?: boolean;
};

type DingConnectProduct = {
  SkuCode?: string;
  ProviderCode?: string;
  CountryIso?: string;
  DefaultDisplayText?: string;
  Name?: string;
  Description?: string;
  SendValue?: number | null;
  SendCurrencyIso?: string | null;
  ReceiveValue?: number | null;
  ReceiveCurrencyIso?: string | null;
  UatNumber?: string | null;
  ValidityPeriodISO?: string | null;
  Benefits?: unknown;
  ProcessingType?: string | null;
  IsFixedDenomination?: boolean | null;
  Minimum?: number | null;
  Maximum?: number | null;
};

type DingConnectTransferResponse = {
  TransferRef?: string | null;
  DistributorRef?: string | null;
  ProcessingState?: string | null;
  Status?: string | null;
  ErrorCode?: string | null;
  ErrorMessage?: string | null;
  Message?: string | null;
};

let dingConnectTokenCache: DingConnectTokenCache | null = null;

function readTrimmedEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getDingConnectConfig() {
  const clientId = readTrimmedEnv("TOPUP_DINGCONNECT_CLIENT_ID");
  const clientSecret = readTrimmedEnv("TOPUP_DINGCONNECT_CLIENT_SECRET");

  if (!clientId) {
    throw new Error("Missing TOPUP_DINGCONNECT_CLIENT_ID.");
  }

  if (!clientSecret) {
    throw new Error("Missing TOPUP_DINGCONNECT_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret,
    apiBaseUrl: readTrimmedEnv("TOPUP_DINGCONNECT_BASE_URL") ?? DINGCONNECT_API_BASE_URL,
  };
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, "");
}

async function getDingConnectAccessToken() {
  const now = Date.now();
  if (dingConnectTokenCache && dingConnectTokenCache.expiresAt - 30_000 > now) {
    return dingConnectTokenCache.accessToken;
  }

  const config = getDingConnectConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);

  const response = await fetch(DINGCONNECT_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
        error?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ??
        payload?.error ??
        "DingConnect authentication failed."
    );
  }

  dingConnectTokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in ?? 0)) * 1000,
  };

  return dingConnectTokenCache.accessToken;
}

async function dingConnectFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getDingConnectAccessToken();
  const config = getDingConnectConfig();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    const maybeMessage =
      payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).ErrorMessage as string | undefined) ??
          ((payload as Record<string, unknown>).Message as string | undefined) ??
          ((payload as Record<string, unknown>).message as string | undefined)
        : undefined;
    throw new Error(
      maybeMessage ?? `DingConnect request failed with ${response.status}.`
    );
  }

  return payload as T;
}

function extractItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.Items)) return record.Items as T[];
    if (Array.isArray(record.items)) return record.items as T[];
    if (Array.isArray(record.Results)) return record.Results as T[];
    if (Array.isArray(record.results)) return record.results as T[];
  }
  return [];
}

function summarizeUnknownRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      type: Array.isArray(value) ? "array" : typeof value,
    };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sample: Record<string, unknown> = {};

  for (const key of keys.slice(0, 8)) {
    const fieldValue = record[key];
    sample[key] =
      fieldValue == null ||
      typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean"
        ? fieldValue
        : Array.isArray(fieldValue)
        ? `[array:${fieldValue.length}]`
        : "[object]";
  }

  return {
    keys,
    sample,
  };
}

function mapDingConnectProcessingState(
  state: string | null | undefined
): PurchaseBundleResult["providerStatus"] {
  const normalized = state?.trim().toLowerCase() ?? "";

  if (normalized === "complete" || normalized === "completed" || normalized === "successful") {
    return "delivered";
  }

  if (
    normalized === "submitted" ||
    normalized === "processing" ||
    normalized === "inprogress" ||
    normalized === "queued" ||
    normalized === "pending"
  ) {
    return "pending";
  }

  if (
    normalized === "failed" ||
    normalized === "rejected" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  ) {
    return "failed";
  }

  return "unknown";
}

function mapDingConnectFulfillmentStatus(
  state: string | null | undefined
): FulfillmentStatusResult["providerStatus"] {
  const status = mapDingConnectProcessingState(state);
  return status === "accepted" ? "pending" : status;
}

function mapDingConnectProductType(product: DingConnectProduct) {
  const benefits = Array.isArray(product.Benefits)
    ? product.Benefits.map((value) => String(value).toLowerCase())
    : [];
  const processingType = product.ProcessingType?.trim().toLowerCase() ?? "";

  if (
    benefits.some((value) => value.includes("data") || value.includes("bundle")) ||
    processingType.includes("data") ||
    processingType.includes("bundle")
  ) {
    return "data_bundle" as const;
  }

  return "airtime" as const;
}

function deriveProductDisplayName(product: DingConnectProduct, providerName: string) {
  return (
    product.DefaultDisplayText?.trim() ||
    product.Name?.trim() ||
    `${providerName} ${product.SkuCode?.trim() || "Top-Up"}`
  );
}

async function ensureDingConnectProviderRow(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("data_topup_providers")
    .upsert(
      {
        code: "dingconnect",
        name: "DingConnect",
        is_active: true,
        capabilities: {
          mode: "live_api",
          catalogSource: "dingconnect",
          supportsFulfillmentCallbacks: false,
          supportsPaymentWebhooks: false,
          supportsCatalogSync: true,
          supportsAirtime: true,
          supportsDataBundles: true,
        },
      },
      {
        onConflict: "code",
      }
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error("Unable to upsert the DingConnect top-up provider row.");
  }

  return data.id as string;
}

export async function syncDingConnectCatalog(params: {
  supabaseAdmin: SupabaseClient;
  countryCodes: string[];
  activate?: boolean;
}) {
  const { supabaseAdmin } = params;
  const providerId = await ensureDingConnectProviderRow(supabaseAdmin);
  const activate = Boolean(params.activate);
  const normalizedCountries = Array.from(
    new Set(
      params.countryCodes
        .map((countryCode) => countryCode.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCountries.length === 0) {
    throw new Error("DingConnect catalog sync requires at least one country code.");
  }

  const providersPayload = await dingConnectFetchJson<unknown>(
    `/api/V1/GetProviders?countryIsos=${encodeURIComponent(
      normalizedCountries.join(",")
    )}`
  );
  const providers = extractItems<DingConnectProvider>(providersPayload);

  const providerByCode = new Map<string, DingConnectProvider>();
  const summary = {
    providerId,
    countries: normalizedCountries,
    activate,
    providersFetched: providers.length,
    networksUpserted: 0,
    productsUpserted: 0,
    skippedProducts: [] as string[],
    productsPayloadShape: null as Record<string, unknown> | null,
    sampleProductShapes: [] as Array<Record<string, unknown>>,
  };

  for (const provider of providers) {
    const providerCode = provider.ProviderCode?.trim();
    const countryCode = provider.CountryIso?.trim().toUpperCase();
    if (!providerCode || !countryCode) continue;

    providerByCode.set(providerCode, provider);

    const { error: networkError } = await supabaseAdmin
      .from("data_topup_networks")
      .upsert(
        {
          provider_id: providerId,
          country_code: countryCode,
          network_code: providerCode,
          name: provider.ShortName?.trim() || provider.Name?.trim() || providerCode,
          is_active: activate,
          provider_metadata: {
            source: "dingconnect",
            providerCode,
            providerName: provider.Name?.trim() || null,
            shortName: provider.ShortName?.trim() || null,
            logoUrl: provider.LogoUrl ?? null,
            supportsProducts: provider.SupportsProducts ?? null,
          },
        },
        {
          onConflict: "provider_id,country_code,network_code",
        }
      );

    if (networkError) {
      throw new Error(`Unable to upsert DingConnect network ${providerCode}.`);
    }

    summary.networksUpserted += 1;
  }

  const productsPayload = await dingConnectFetchJson<unknown>(
    `/api/V1/GetProducts?countryIsos=${encodeURIComponent(
      normalizedCountries.join(",")
    )}`
  );
  summary.productsPayloadShape = summarizeUnknownRecord(productsPayload);
  const products = extractItems<DingConnectProduct>(productsPayload);

  for (const product of products) {
    if (summary.sampleProductShapes.length < 3) {
      summary.sampleProductShapes.push(summarizeUnknownRecord(product));
    }

    const skuCode = product.SkuCode?.trim();
    const providerCode = product.ProviderCode?.trim();
    const countryCode = product.CountryIso?.trim().toUpperCase();

    if (!skuCode || !providerCode || !countryCode) {
      if (summary.skippedProducts.length < 10) {
        summary.skippedProducts.push(
          `Skipped product with missing sku/provider/country. Keys: ${Object.keys(
            (product as Record<string, unknown>) ?? {}
          ).join(", ")}`
        );
      }
      continue;
    }

    const sendValue = coerceNumber(product.SendValue);
    const sendCurrency = product.SendCurrencyIso?.trim().toUpperCase() ?? null;
    const receiveValue = coerceNumber(product.ReceiveValue);
    const receiveCurrency = product.ReceiveCurrencyIso?.trim().toUpperCase() ?? null;

    if (sendValue == null || sendCurrency == null || receiveValue == null) {
      if (summary.skippedProducts.length < 10) {
        summary.skippedProducts.push(
          `${skuCode}: missing send/receive pricing data.`
        );
      }
      continue;
    }

    const isFixed =
      typeof product.IsFixedDenomination === "boolean"
        ? product.IsFixedDenomination
        : true;

    if (!isFixed) {
      if (summary.skippedProducts.length < 10) {
        summary.skippedProducts.push(
          `${skuCode}: variable denomination product skipped for now.`
        );
      }
      continue;
    }

    const { data: networkRow, error: networkLookupError } = await supabaseAdmin
      .from("data_topup_networks")
      .select("id, name")
      .eq("provider_id", providerId)
      .eq("country_code", countryCode)
      .eq("network_code", providerCode)
      .maybeSingle();

    if (networkLookupError || !networkRow?.id) {
      throw new Error(`Unable to find DingConnect network ${providerCode} for ${skuCode}.`);
    }

    const providerName =
      providerByCode.get(providerCode)?.ShortName?.trim() ||
      providerByCode.get(providerCode)?.Name?.trim() ||
      networkRow.name ||
      providerCode;

    const displayName = deriveProductDisplayName(product, providerName);
    const productType = mapDingConnectProductType(product);

    const { error: productError } = await supabaseAdmin
      .from("data_topup_products")
      .upsert(
        {
          provider_id: providerId,
          network_id: networkRow.id,
          provider_product_code: skuCode,
          product_type: productType,
          display_name: displayName,
          description:
            product.Description?.trim() ||
            `${providerName} ${productType === "airtime" ? "airtime" : "data"} top-up via DingConnect.`,
          currency: sendCurrency,
          face_value: receiveValue,
          retail_price: sendValue,
          cost_price: null,
          data_volume_label: null,
          validity_label: product.ValidityPeriodISO ?? null,
          is_active: activate,
          provider_metadata: {
            source: "dingconnect",
            providerCode,
            countryCode,
            receiveCurrency: receiveCurrency ?? sendCurrency,
            receiveValue,
            sendCurrency,
            sendValue,
            uatNumber: product.UatNumber ?? null,
            validityPeriodISO: product.ValidityPeriodISO ?? null,
            benefits: Array.isArray(product.Benefits) ? product.Benefits : [],
            isFixedDenomination: isFixed,
          },
        },
        {
          onConflict: "provider_id,provider_product_code",
        }
      );

    if (productError) {
      throw new Error(`Unable to upsert DingConnect product ${skuCode}.`);
    }

    summary.productsUpserted += 1;
  }

  return summary;
}

export const dingConnectTopupAggregatorAdapter: TopupAggregatorAdapter = {
  providerCode: "dingconnect",
  async listProducts() {
    return [];
  },
  async purchaseBundle(input: PurchaseBundleInput): Promise<PurchaseBundleResult> {
    const response = await dingConnectFetchJson<DingConnectTransferResponse>(
      "/api/V1/SendTransfer",
      {
        method: "POST",
        body: JSON.stringify({
          SkuCode: input.providerProductCode,
          SendValue: Number(input.amount),
          AccountNumber: digitsOnly(input.recipientMsisdn) || input.recipientMsisdn,
          DistributorRef: input.providerRequestRef,
          ValidateOnly: false,
        }),
      }
    );

    const providerStatus = mapDingConnectProcessingState(
      response.ProcessingState ?? response.Status ?? null
    );

    return {
      accepted: providerStatus !== "failed",
      providerTransactionRef:
        response.DistributorRef?.trim() || input.providerRequestRef,
      providerStatus,
      providerMessage:
        response.ErrorMessage?.trim() ||
        response.Message?.trim() ||
        response.ErrorCode?.trim() ||
        null,
      raw: response as Record<string, unknown>,
    };
  },
  async getFulfillmentStatus(
    providerTransactionRef: string
  ): Promise<FulfillmentStatusResult> {
    const responsePayload = await dingConnectFetchJson<unknown>(
      "/api/V1/ListTransferRecords",
      {
        method: "POST",
        body: JSON.stringify({
          DistributorRefs: [providerTransactionRef],
          PageNumber: 1,
          PageSize: 1,
        }),
      }
    );

    const records = extractItems<DingConnectTransferResponse>(responsePayload);
    const record = records[0];

    if (!record) {
      return {
        providerStatus: "unknown",
        providerRequestRef: providerTransactionRef,
        providerTransactionRef,
        providerMessage: "DingConnect returned no transfer record for this reference.",
        raw:
          responsePayload && typeof responsePayload === "object"
            ? (responsePayload as Record<string, unknown>)
            : { response: responsePayload },
      };
    }

    return {
      providerStatus: mapDingConnectFulfillmentStatus(
        record.ProcessingState ?? record.Status ?? null
      ),
      providerRequestRef: record.DistributorRef?.trim() || providerTransactionRef,
      providerTransactionRef: record.DistributorRef?.trim() || providerTransactionRef,
      providerMessage:
        record.ErrorMessage?.trim() ||
        record.Message?.trim() ||
        record.ErrorCode?.trim() ||
        null,
      raw: record as Record<string, unknown>,
    };
  },
};
