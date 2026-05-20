import type { SupabaseClient } from "@supabase/supabase-js";
import { Buffer } from "buffer";
import { isTopupProductAllowedByCatalogRules } from "@/lib/topup/catalogRules";
import type {
  FulfillmentStatusResult,
  PurchaseBundleInput,
  PurchaseBundleResult,
  TopupAggregatorAdapter,
} from "@/lib/topup/providers/base";

const DTONE_LIVE_BASE_URL = "https://dvs-api.dtone.com/v1";
const DTONE_PREPROD_BASE_URL = "https://preprod-dvs-api.dtone.com/v1";
const DTONE_MOBILE_SERVICE_ID = 1;
const DTONE_AIRTIME_SUBSERVICE_ID = 11;
const DTONE_BUNDLE_SUBSERVICE_ID = 12;
const DTONE_DATA_SUBSERVICE_ID = 13;
const DTONE_PRODUCTS_PER_PAGE = 100;
const DTONE_MAX_PRODUCT_PAGES = 20;

const COUNTRY_DIAL_CODES: Record<string, string[]> = {
  SL: ["232"],
  NG: ["234"],
  LR: ["231"],
  GN: ["224"],
  GM: ["220"],
  KE: ["254"],
  GH: ["233"],
};

type DtOneEnvironment = "live" | "preproduction";

type DtOneProduct = {
  id?: number | string | null;
  name?: string | null;
  description?: string | null;
  type?: string | null;
  service?: {
    id?: number | null;
    name?: string | null;
    subservice?: {
      id?: number | null;
      name?: string | null;
    } | null;
  } | null;
  operator?: {
    id?: number | null;
    name?: string | null;
    country?: {
      iso_code?: string | null;
      name?: string | null;
    } | null;
  } | null;
  prices?: {
    wholesale?: {
      unit?: string | null;
      amount?: number | string | null;
      fee?: number | string | null;
    } | null;
    retail?: {
      unit?: string | null;
      amount?: number | string | null;
      fee?: number | string | null;
    } | null;
  } | null;
  benefits?: Array<{
    type?: string | null;
    unit?: string | null;
    unit_type?: string | null;
    amount?:
      | {
          total_including_tax?: number | string | null;
          total_excluding_tax?: number | string | null;
          base?: number | string | null;
        }
      | number
      | string
      | null;
    additional_information?: string | null;
  }> | null;
  requested_values?: {
    source?: {
      unit?: string | null;
      amount?: number | string | null;
    } | null;
    destination?: {
      unit?: string | null;
      amount?: number | string | null;
    } | null;
  } | null;
  adjusted_values?: {
    source?: {
      unit?: string | null;
      amount?: number | string | null;
    } | null;
    destination?: {
      unit?: string | null;
      amount?: number | string | null;
    } | null;
  } | null;
  required_credit_party_identifier_fields?: unknown;
  required_sender_fields?: unknown;
  required_beneficiary_fields?: unknown;
  tags?: string[] | null;
  pin?: {
    validity?: {
      unit?: string | null;
      quantity?: number | string | null;
    } | null;
  } | null;
};

type DtOneTransaction = {
  id?: number | string | null;
  external_id?: string | null;
  operator_reference?: string | null;
  status?: {
    id?: number | string | null;
    message?: string | null;
    class?: {
      id?: number | string | null;
      message?: string | null;
    } | null;
  } | null;
  product?: {
    id?: number | string | null;
    name?: string | null;
    operator?: {
      id?: number | string | null;
      name?: string | null;
      country?: {
        iso_code?: string | null;
      } | null;
    } | null;
  } | null;
};

function readTrimmedEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
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

function getDtOneEnvironment(): DtOneEnvironment {
  const value = readTrimmedEnv("TOPUP_DTONE_ENVIRONMENT")?.toLowerCase();
  if (value === "preproduction" || value === "preprod" || value === "sandbox") {
    return "preproduction";
  }
  return "live";
}

function getDtOneConfig() {
  const apiKey = readTrimmedEnv("TOPUP_DTONE_API_KEY");
  const apiSecret = readTrimmedEnv("TOPUP_DTONE_API_SECRET");

  if (!apiKey) {
    throw new Error("Missing TOPUP_DTONE_API_KEY.");
  }

  if (!apiSecret) {
    throw new Error("Missing TOPUP_DTONE_API_SECRET.");
  }

  const environment = getDtOneEnvironment();
  const baseUrl =
    readTrimmedEnv("TOPUP_DTONE_BASE_URL") ??
    (environment === "live" ? DTONE_LIVE_BASE_URL : DTONE_PREPROD_BASE_URL);

  return {
    apiKey,
    apiSecret,
    environment,
    baseUrl,
    callbackUrl: readTrimmedEnv("TOPUP_DTONE_CALLBACK_URL"),
  };
}

function buildDtOneAuthHeader() {
  const config = getDtOneConfig();
  const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
  return `Basic ${token}`;
}

async function dtOneFetch(path: string, init?: RequestInit) {
  const config = getDtOneConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: buildDtOneAuthHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).message as string | undefined) ??
          ((payload as Record<string, unknown>).error as string | undefined) ??
          ((payload as Record<string, unknown>).detail as string | undefined)
        : typeof payload === "string"
        ? payload
        : undefined;

    throw new Error(
      message ??
        (payload != null && typeof payload !== "string"
          ? `DT One request failed with ${response.status}: ${JSON.stringify(payload)}`
          : `DT One request failed with ${response.status}.`)
    );
  }

  return payload;
}

function extractItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as T[];
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.results)) return record.results as T[];
  }
  return [];
}

function getRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecordNumber(record: Record<string, unknown>, key: string) {
  return coerceNumber(record[key]);
}

function getDtOneStatusId(transaction: DtOneTransaction | Record<string, unknown>) {
  const status = (transaction as DtOneTransaction).status;
  if (status && typeof status === "object") {
    return coerceNumber(status.id);
  }
  return null;
}

function mapDtOneStatus(
  transaction: DtOneTransaction | Record<string, unknown>
): PurchaseBundleResult["providerStatus"] {
  const statusId = getDtOneStatusId(transaction);
  if (statusId === 7) return "delivered";
  if (statusId === 1 || statusId === 2 || statusId === 5) return "pending";
  if (statusId === 3 || statusId === 4 || statusId === 8 || statusId === 9) {
    return "failed";
  }
  return "unknown";
}

function mapDtOneStatusForFulfillment(
  transaction: DtOneTransaction | Record<string, unknown>
): FulfillmentStatusResult["providerStatus"] {
  const status = mapDtOneStatus(transaction);
  return status === "accepted" ? "pending" : status;
}

function buildDtOneRecipientMsisdn(input: {
  countryCode: string;
  recipientMsisdn: string;
}) {
  const isoCountryCode = input.countryCode.trim().toUpperCase();
  const dialCodeCandidates = COUNTRY_DIAL_CODES[isoCountryCode] ?? [];
  const rawDigits = digitsOnly(input.recipientMsisdn);

  if (!rawDigits) {
    throw new Error("DT One top-up requires a valid recipient phone number.");
  }

  for (const dialCode of dialCodeCandidates) {
    if (rawDigits.startsWith(dialCode) && rawDigits.length > dialCode.length) {
      return `+${rawDigits}`;
    }
  }

  if (dialCodeCandidates.length > 0) {
    const localNumber = rawDigits.replace(/^0+/, "");
    if (localNumber.length >= 6) {
      return `+${dialCodeCandidates[0]}${localNumber}`;
    }
  }

  return rawDigits.startsWith("+") ? rawDigits : `+${rawDigits}`;
}

function deriveDtOneProductType(product: DtOneProduct) {
  const subserviceId = coerceNumber(product.service?.subservice?.id);
  if (subserviceId === DTONE_AIRTIME_SUBSERVICE_ID) return "airtime";
  if (
    subserviceId === DTONE_BUNDLE_SUBSERVICE_ID ||
    subserviceId === DTONE_DATA_SUBSERVICE_ID
  ) {
    return "data_bundle";
  }

  const benefitTypes = (product.benefits ?? [])
    .map((benefit) => benefit?.type?.trim().toUpperCase())
    .filter((value): value is string => Boolean(value));

  if (benefitTypes.includes("DATA")) return "data_bundle";
  return "airtime";
}

function deriveDtOneFaceValue(product: DtOneProduct) {
  const destinationAmount =
    coerceNumber(product.adjusted_values?.destination?.amount) ??
    coerceNumber(product.requested_values?.destination?.amount);

  if (destinationAmount != null) return destinationAmount;

  const benefitAmount =
    product.benefits
      ?.map((benefit) => {
        if (
          benefit?.amount &&
          typeof benefit.amount === "object" &&
          !Array.isArray(benefit.amount)
        ) {
          return (
            coerceNumber(benefit.amount.total_including_tax) ??
            coerceNumber(benefit.amount.total_excluding_tax) ??
            coerceNumber(benefit.amount.base)
          );
        }
        return coerceNumber(benefit?.amount);
      })
      .find((value) => value != null) ?? null;

  if (benefitAmount != null) return benefitAmount;

  return coerceNumber(product.prices?.retail?.amount);
}

function deriveDtOneValidityLabel(product: DtOneProduct) {
  const quantity = coerceNumber(product.pin?.validity?.quantity);
  const unit = product.pin?.validity?.unit?.trim().toUpperCase() ?? null;
  if (quantity != null && unit) {
    return `${unit}:${quantity}`;
  }
  return null;
}

function deriveDtOneDataVolumeLabel(product: DtOneProduct) {
  const dataBenefit = (product.benefits ?? []).find(
    (benefit) => benefit?.type?.trim().toUpperCase() === "DATA"
  );

  if (!dataBenefit) return null;

  const amount =
    dataBenefit.amount &&
    typeof dataBenefit.amount === "object" &&
    !Array.isArray(dataBenefit.amount)
      ? coerceNumber(dataBenefit.amount.total_including_tax) ??
        coerceNumber(dataBenefit.amount.total_excluding_tax) ??
        coerceNumber(dataBenefit.amount.base)
      : coerceNumber(dataBenefit.amount);

  const unit = dataBenefit.unit?.trim() ?? null;

  if (amount != null && unit) {
    return `${amount} ${unit}`;
  }

  return dataBenefit.additional_information?.trim() ?? null;
}

function getDtOneStatusMessage(transaction: DtOneTransaction | Record<string, unknown>) {
  const record = transaction as DtOneTransaction;
  return (
    record.status?.message?.trim() ??
    record.status?.class?.message?.trim() ??
    null
  );
}

async function ensureDtOneProviderRow(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("data_topup_providers")
    .upsert(
      {
        code: "dtone",
        name: "DT One",
        is_active: true,
        capabilities: {
          mode: "live_api",
          catalogSource: "dtone",
          supportsFulfillmentCallbacks: true,
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
    throw new Error("Unable to upsert the DT One top-up provider row.");
  }

  return data.id as string;
}

async function listDtOneProductsForCountry(countryCode: string) {
  const products: DtOneProduct[] = [];

  for (let page = 1; page <= DTONE_MAX_PRODUCT_PAGES; page += 1) {
    const payload = await dtOneFetch(
      `/products?country_iso_code=${encodeURIComponent(
        countryCode
      )}&type=FIXED_VALUE_RECHARGE&per_page=${DTONE_PRODUCTS_PER_PAGE}&page=${page}`
    );

    const pageItems = extractItems<DtOneProduct>(payload).filter(
      (product) => coerceNumber(product.service?.id) === DTONE_MOBILE_SERVICE_ID
    );
    if (pageItems.length === 0) break;

    products.push(...pageItems);

    if (pageItems.length < DTONE_PRODUCTS_PER_PAGE) {
      break;
    }
  }

  return products;
}

export async function syncDtOneCatalog(params: {
  supabaseAdmin: SupabaseClient;
  countryCodes: string[];
  activate?: boolean;
}) {
  const { supabaseAdmin } = params;
  const providerId = await ensureDtOneProviderRow(supabaseAdmin);
  const activate = Boolean(params.activate);
  const normalizedCountries = Array.from(
    new Set(
      params.countryCodes
        .map((countryCode) => countryCode.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCountries.length === 0) {
    throw new Error("DT One catalog sync requires at least one country code.");
  }

  const summary = {
    providerId,
    countries: normalizedCountries,
    activate,
    productsFetched: 0,
    networksUpserted: 0,
    productsUpserted: 0,
    skippedProducts: [] as string[],
  };

  for (const countryCode of normalizedCountries) {
    const products = await listDtOneProductsForCountry(countryCode);
    const networkCache = new Map<string, { id: string; name: string }>();

    for (const product of products) {
      summary.productsFetched += 1;

      const productId = coerceNumber(product.id);
      const operatorId = coerceNumber(product.operator?.id);
      const operatorName = product.operator?.name?.trim();
      const productCountryCode =
        product.operator?.country?.iso_code?.trim().toUpperCase() ?? countryCode;
      const currency = product.prices?.retail?.unit?.trim().toUpperCase() ?? null;
      const retailPrice = coerceNumber(product.prices?.retail?.amount);
      const costPrice = coerceNumber(product.prices?.wholesale?.amount);
      const faceValue = deriveDtOneFaceValue(product);

      if (!productId || !operatorId || !operatorName || !currency || retailPrice == null) {
        if (summary.skippedProducts.length < 20) {
          summary.skippedProducts.push(
            `${countryCode}: skipped product missing id/operator/pricing.`
          );
        }
        continue;
      }

      const productType = deriveDtOneProductType(product);
      const networkCode = `dtone-op-${operatorId}`;
      const networkCacheKey = `${productCountryCode}:${networkCode}`;
      let networkRow = networkCache.get(networkCacheKey) ?? null;

      if (!networkRow) {
        const { data, error } = await supabaseAdmin
          .from("data_topup_networks")
          .upsert(
            {
              provider_id: providerId,
              country_code: productCountryCode,
              network_code: networkCode,
              name: operatorName,
              is_active: activate,
              provider_metadata: {
                source: "dtone",
                operatorId,
                operatorName,
                countryCode: productCountryCode,
                logoUrl: `https://operator-logo.dtone.com/logo-${operatorId}-1.png`,
              },
            },
            {
              onConflict: "provider_id,country_code,network_code",
            }
          )
          .select("id, name")
          .single();

        if (error || !data?.id) {
          throw new Error(`Unable to upsert DT One network ${operatorName}.`);
        }

        networkRow = {
          id: data.id as string,
          name: data.name as string,
        };
        networkCache.set(networkCacheKey, networkRow);
        summary.networksUpserted += 1;
      }

      const isAllowed =
        faceValue != null &&
        isTopupProductAllowedByCatalogRules({
          countryCode: productCountryCode,
          currency,
          retailPrice,
        });

      const providerProductCode = String(productId);
      const displayName = product.name?.trim() || `${operatorName} ${currency} ${retailPrice}`;

      const { error: productError } = await supabaseAdmin
        .from("data_topup_products")
        .upsert(
          {
            provider_id: providerId,
            network_id: networkRow.id,
            product_type: productType,
            provider_product_code: providerProductCode,
            display_name: displayName,
            description:
              product.description?.trim() ||
              `${operatorName} ${productType === "airtime" ? "airtime" : "data"} top-up via DT One.`,
            currency,
            face_value: faceValue ?? retailPrice,
            retail_price: retailPrice,
            cost_price: costPrice,
            data_volume_label: deriveDtOneDataVolumeLabel(product),
            validity_label: deriveDtOneValidityLabel(product),
            is_active: activate && isAllowed,
            provider_metadata: {
              source: "dtone",
              productId,
              operatorId,
              serviceId: coerceNumber(product.service?.id),
              serviceName: product.service?.name?.trim() ?? null,
              subserviceId: coerceNumber(product.service?.subservice?.id),
              subserviceName: product.service?.subservice?.name?.trim() ?? null,
              tags: Array.isArray(product.tags) ? product.tags : [],
              requiredCreditPartyIdentifierFields:
                product.required_credit_party_identifier_fields ?? null,
              requiredSenderFields: product.required_sender_fields ?? null,
              requiredBeneficiaryFields: product.required_beneficiary_fields ?? null,
              logoUrl: `https://operator-logo.dtone.com/logo-${operatorId}-1.png`,
            },
          },
          {
            onConflict: "provider_id,provider_product_code",
          }
        );

      if (productError) {
        throw new Error(`Unable to upsert DT One product ${providerProductCode}.`);
      }

      summary.productsUpserted += 1;
    }
  }

  return summary;
}

export const dtOneTopupAggregatorAdapter: TopupAggregatorAdapter = {
  providerCode: "dtone",
  async listProducts() {
    return [];
  },
  async purchaseBundle(input: PurchaseBundleInput): Promise<PurchaseBundleResult> {
    const productId = Number(input.providerProductCode);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error("DT One top-up requires a valid provider product id.");
    }

    const callbackUrl = getDtOneConfig().callbackUrl;
    const payload = {
      external_id: input.providerRequestRef,
      product_id: productId,
      auto_confirm: true,
      credit_party_identifier: {
        mobile_number: buildDtOneRecipientMsisdn({
          countryCode: input.countryCode,
          recipientMsisdn: input.recipientMsisdn,
        }),
      },
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    };

    const response = (await dtOneFetch("/sync/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    })) as DtOneTransaction;

    const providerStatus = mapDtOneStatus(response);
    const providerTransactionRef =
      response.id != null
        ? String(response.id)
        : response.operator_reference?.trim() || input.providerRequestRef;

    return {
      accepted: providerStatus !== "failed",
      providerTransactionRef,
      providerStatus,
      providerMessage: getDtOneStatusMessage(response),
      raw: response as Record<string, unknown>,
    };
  },
  async getFulfillmentStatus(
    providerTransactionRef: string
  ): Promise<FulfillmentStatusResult> {
    const response = (await dtOneFetch(
      `/transactions/${encodeURIComponent(providerTransactionRef)}`
    )) as DtOneTransaction;

    return {
      providerStatus: mapDtOneStatusForFulfillment(response),
      providerRequestRef: response.external_id?.trim() ?? null,
      providerTransactionRef:
        response.id != null ? String(response.id) : providerTransactionRef,
      providerMessage: getDtOneStatusMessage(response),
      raw: response as Record<string, unknown>,
    };
  },
  async parseWebhook(payload): Promise<FulfillmentStatusResult | null> {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const transactionId = getRecordNumber(record, "id");
    const externalId = getRecordString(record, "external_id");
    const status =
      "status" in record && record.status && typeof record.status === "object"
        ? (record as DtOneTransaction)
        : null;

    if (!transactionId && !externalId && !status) {
      return null;
    }

    return {
      providerStatus: mapDtOneStatusForFulfillment(record),
      providerRequestRef: externalId,
      providerTransactionRef:
        transactionId != null ? String(transactionId) : null,
      providerMessage: getDtOneStatusMessage(record),
      raw: record,
    };
  },
};
