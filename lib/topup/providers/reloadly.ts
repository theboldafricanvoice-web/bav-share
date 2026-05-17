import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { isTopupProductAllowedByCatalogRules } from "@/lib/topup/catalogRules";
import type {
  FulfillmentStatusResult,
  PurchaseBundleInput,
  PurchaseBundleResult,
  TopupAggregatorAdapter,
} from "@/lib/topup/providers/base";

const RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token";
const RELOADLY_ACCEPT = "application/com.reloadly.topups-v1+json";

type ReloadlyEnvironment = "live" | "sandbox";

type ReloadlyOperator = {
  id?: number;
  operatorId?: number;
  name?: string;
  bundle?: boolean;
  data?: boolean;
  pin?: boolean;
  denominationType?: string;
  destinationCurrencyCode?: string;
  localMinAmount?: number | null;
  localMaxAmount?: number | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  mostPopularLocalAmount?: number | null;
  mostPopularAmount?: number | null;
  suggestedAmounts?: unknown;
  suggestedAmountsMap?: unknown;
  country?: {
    isoName?: string;
    name?: string;
  } | null;
  fx?: {
    currencyCode?: string;
  } | null;
};

type ReloadlyTopupResponse = {
  transactionId?: number | string | null;
  operatorTransactionId?: string | null;
  status?: string | null;
  message?: string | null;
  code?: string | null;
  transaction?: {
    transactionId?: number | string | null;
    operatorTransactionId?: string | null;
    status?: string | null;
  } | null;
};

type ReloadlyTokenCache = {
  accessToken: string;
  expiresAt: number;
};

let reloadlyTokenCache: ReloadlyTokenCache | null = null;

const COUNTRY_DIAL_CODES: Record<string, string[]> = {
  SL: ["232"],
  NG: ["234"],
  LR: ["231"],
  GN: ["224"],
  GM: ["220"],
  KE: ["254"],
  GH: ["233"],
};

function readTrimmedEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readNestedString(
  value: unknown,
  path: Array<string | number>
): string | null {
  let current: unknown = value;

  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string | number, unknown>)[segment];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getReloadlyWebhookSecret() {
  return readTrimmedEnv("TOPUP_RELOADLY_WEBHOOK_SECRET");
}

function getReloadlyEnvironment(): ReloadlyEnvironment {
  const raw = readTrimmedEnv("TOPUP_RELOADLY_ENVIRONMENT")?.toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

function getReloadlyBaseUrl(environment = getReloadlyEnvironment()) {
  return environment === "live"
    ? "https://topups.reloadly.com"
    : "https://topups-sandbox.reloadly.com";
}

function getReloadlyAudience(environment = getReloadlyEnvironment()) {
  return environment === "live"
    ? "https://topups.reloadly.com"
    : "https://topups-sandbox.reloadly.com";
}

function getReloadlyConfig() {
  const clientId = readTrimmedEnv("TOPUP_RELOADLY_CLIENT_ID");
  const clientSecret = readTrimmedEnv("TOPUP_RELOADLY_CLIENT_SECRET");

  if (!clientId) {
    throw new Error("Missing TOPUP_RELOADLY_CLIENT_ID.");
  }

  if (!clientSecret) {
    throw new Error("Missing TOPUP_RELOADLY_CLIENT_SECRET.");
  }

  const environment = getReloadlyEnvironment();

  return {
    clientId,
    clientSecret,
    environment,
    audience: getReloadlyAudience(environment),
    baseUrl: getReloadlyBaseUrl(environment),
  };
}

async function getReloadlyAccessToken() {
  const now = Date.now();
  if (reloadlyTokenCache && reloadlyTokenCache.expiresAt - 30_000 > now) {
    return reloadlyTokenCache.accessToken;
  }

  const config = getReloadlyConfig();

  const response = await fetch(RELOADLY_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      audience: config.audience,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        message?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ??
        payload?.message ??
        "Reloadly authentication failed."
    );
  }

  reloadlyTokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in ?? 0)) * 1000,
  };

  return reloadlyTokenCache.accessToken;
}

async function reloadlyFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getReloadlyAccessToken();
  const config = getReloadlyConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: RELOADLY_ACCEPT,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as T | null;

  if (!response.ok) {
    const maybeMessage =
      payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).message as string | undefined) ??
          ((payload as Record<string, unknown>).error as string | undefined)
        : undefined;

    throw new Error(maybeMessage ?? `Reloadly request failed with ${response.status}.`);
  }

  return payload as T;
}

function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, "");
}

function buildReloadlyRecipientPhone(input: {
  countryCode: string;
  recipientMsisdn: string;
}) {
  const isoCountryCode = input.countryCode.trim().toUpperCase();
  const dialCodeCandidates = COUNTRY_DIAL_CODES[isoCountryCode] ?? [];
  const rawDigits = digitsOnly(input.recipientMsisdn);

  if (!rawDigits) {
    throw new Error("Reloadly top-up requires a valid recipient phone number.");
  }

  for (const dialCode of dialCodeCandidates) {
    if (rawDigits.startsWith(dialCode) && rawDigits.length > dialCode.length) {
      return {
        countryCode: isoCountryCode,
        number: rawDigits.slice(dialCode.length),
      };
    }
  }

  if (dialCodeCandidates.length > 0) {
    const localNumber = rawDigits.replace(/^0+/, "");
    if (localNumber.length >= 6) {
      return {
        countryCode: isoCountryCode,
        number: localNumber,
      };
    }
  }

  throw new Error(
    `Reloadly could not derive a valid local phone number from ${input.recipientMsisdn} for ${isoCountryCode}.`
  );
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function uniqueSortedPositive(values: number[]) {
  return Array.from(
    new Set(values.filter((value) => Number.isFinite(value) && value > 0))
  ).sort((left, right) => left - right);
}

function mapReloadlyStatus(
  status: string | null | undefined
): PurchaseBundleResult["providerStatus"] {
  const normalized = status?.trim().toUpperCase() ?? "";

  if (normalized === "SUCCESSFUL") return "delivered";
  if (normalized === "PROCESSING") return "pending";
  if (normalized === "FAILED" || normalized === "REFUNDED" || normalized === "REJECTED") {
    return "failed";
  }

  if (normalized === "PENDING" || normalized === "ACCEPTED" || normalized === "SUBMITTED") {
    return "pending";
  }

  return "unknown";
}

function mapReloadlyStatusForFulfillment(
  status: string | null | undefined
): FulfillmentStatusResult["providerStatus"] {
  const mapped = mapReloadlyStatus(status);
  return mapped === "accepted" ? "pending" : mapped;
}

function normalizeReloadlySignature(signature: string) {
  const trimmed = signature.trim();
  const prefixedMatch = trimmed.match(/^[a-z0-9_-]+=([A-Za-z0-9+/=]+)$/i);
  return prefixedMatch?.[1]?.trim() || trimmed;
}

function constantTimeMatches(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyReloadlyWebhookSignature(params: {
  rawBody: string;
  requestSignature: string;
  requestTimestamp: string;
}) {
  const secret = getReloadlyWebhookSecret();
  if (!secret) {
    throw new Error("Missing TOPUP_RELOADLY_WEBHOOK_SECRET.");
  }

  const dataToSign = `${params.rawBody}.${params.requestTimestamp}`;
  const expectedHex = createHmac("sha256", secret).update(dataToSign).digest("hex");
  const expectedBase64 = createHmac("sha256", secret)
    .update(dataToSign)
    .digest("base64");
  const providedSignature = normalizeReloadlySignature(params.requestSignature);

  return (
    constantTimeMatches(providedSignature, expectedHex) ||
    constantTimeMatches(providedSignature, expectedBase64)
  );
}

function parseReloadlyWebhookPayload(
  payload: unknown
): FulfillmentStatusResult | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const providerStatus = mapReloadlyStatusForFulfillment(
    readNestedString(payload, ["status"]) ??
      readNestedString(payload, ["transaction", "status"]) ??
      readNestedString(payload, ["data", "status"])
  );

  const providerRequestRef =
    readNestedString(payload, ["customIdentifier"]) ??
    readNestedString(payload, ["transaction", "customIdentifier"]) ??
    readNestedString(payload, ["data", "customIdentifier"]) ??
    readNestedString(payload, ["reference"]) ??
    readNestedString(payload, ["transaction", "reference"]) ??
    readNestedString(payload, ["data", "reference"]);

  const providerTransactionRef =
    readNestedString(payload, ["transactionId"]) ??
    readNestedString(payload, ["transaction", "transactionId"]) ??
    readNestedString(payload, ["data", "transactionId"]) ??
    readNestedString(payload, ["operatorTransactionId"]) ??
    readNestedString(payload, ["transaction", "operatorTransactionId"]) ??
    readNestedString(payload, ["data", "operatorTransactionId"]);

  const providerMessage =
    readNestedString(payload, ["message"]) ??
    readNestedString(payload, ["transaction", "message"]) ??
    readNestedString(payload, ["data", "message"]) ??
    readNestedString(payload, ["code"]) ??
    readNestedString(payload, ["transaction", "code"]) ??
    readNestedString(payload, ["data", "code"]);

  if (!providerRequestRef && !providerTransactionRef) {
    return null;
  }

  return {
    providerStatus,
    providerRequestRef,
    providerTransactionRef,
    providerMessage,
    raw: payload as Record<string, unknown>,
  };
}

function parseReloadlyOperatorId(
  providerProductCode: string,
  networkCode: string
) {
  const fromCode = providerProductCode.match(/^reloadly:(\d+):/i)?.[1];
  if (fromCode) return fromCode;

  const fromNetwork = networkCode.match(/^reloadly-op-(\d+)$/i)?.[1];
  if (fromNetwork) return fromNetwork;

  if (/^\d+$/.test(providerProductCode.trim())) return providerProductCode.trim();
  if (/^\d+$/.test(networkCode.trim())) return networkCode.trim();

  throw new Error(
    `Reloadly order is missing a parseable operator id in providerProductCode (${providerProductCode}).`
  );
}

function deriveSuggestedFaceValues(operator: ReloadlyOperator) {
  const values: number[] = [];

  if (Array.isArray(operator.suggestedAmounts)) {
    for (const entry of operator.suggestedAmounts) {
      const parsed = coerceNumber(entry);
      if (parsed != null) values.push(parsed);
    }
  }

  if (
    operator.suggestedAmountsMap &&
    typeof operator.suggestedAmountsMap === "object" &&
    !Array.isArray(operator.suggestedAmountsMap)
  ) {
    for (const key of Object.keys(operator.suggestedAmountsMap)) {
      const parsedKey = coerceNumber(key);
      if (parsedKey != null) values.push(parsedKey);
    }
  }

  const popularLocal = coerceNumber(operator.mostPopularLocalAmount);
  const popular = coerceNumber(operator.mostPopularAmount);
  const localMin = coerceNumber(operator.localMinAmount);
  const localMax = coerceNumber(operator.localMaxAmount);
  const min = coerceNumber(operator.minAmount);
  const max = coerceNumber(operator.maxAmount);

  if (popularLocal != null) values.push(popularLocal);
  if (popular != null) values.push(popular);
  if (localMin != null) values.push(localMin);
  if (localMax != null) values.push(localMax);
  if (min != null) values.push(min);
  if (max != null) values.push(max);

  return uniqueSortedPositive(values).slice(0, 12);
}

function formatDisplayAmount(currency: string, amount: number) {
  const rounded =
    Math.abs(amount - Math.round(amount)) < 0.001
      ? String(Math.round(amount))
      : amount.toFixed(2);
  return `${currency} ${rounded}`;
}

async function ensureReloadlyProviderRow(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("data_topup_providers")
    .upsert(
      {
        code: "reloadly",
        name: "Reloadly",
        is_active: true,
        capabilities: {
          mode: "live_api",
          catalogSource: "reloadly",
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
    throw new Error("Unable to upsert the Reloadly top-up provider row.");
  }

  return data.id as string;
}

export async function syncReloadlyCatalog(params: {
  supabaseAdmin: SupabaseClient;
  countryCodes: string[];
  activate?: boolean;
}) {
  const { supabaseAdmin } = params;
  const providerId = await ensureReloadlyProviderRow(supabaseAdmin);
  const activate = Boolean(params.activate);
  const normalizedCountries = Array.from(
    new Set(
      params.countryCodes
        .map((countryCode) => countryCode.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCountries.length === 0) {
    throw new Error("Reloadly catalog sync requires at least one country code.");
  }

  const summary = {
    providerId,
    countries: normalizedCountries,
    activate,
    operatorsFetched: 0,
    networksUpserted: 0,
    productsUpserted: 0,
    skippedOperators: [] as string[],
  };

  for (const countryCode of normalizedCountries) {
    const operators = await reloadlyFetchJson<ReloadlyOperator[]>(
      `/operators/countries/${encodeURIComponent(countryCode)}`
    );

    for (const operator of operators ?? []) {
      const operatorId = Number(operator.operatorId ?? operator.id ?? 0);
      if (!Number.isFinite(operatorId) || operatorId <= 0) {
        summary.skippedOperators.push(
          `${countryCode}: operator missing id (${operator.name ?? "unknown"})`
        );
        continue;
      }

      if (operator.pin) {
        summary.skippedOperators.push(
          `${countryCode}: skipped PIN operator ${operator.name ?? operatorId}`
        );
        continue;
      }

      const suggestedValues = deriveSuggestedFaceValues(operator);
      if (suggestedValues.length === 0) {
        summary.skippedOperators.push(
          `${countryCode}: no suggested amounts for ${operator.name ?? operatorId}`
        );
        continue;
      }

      const currency =
        operator.destinationCurrencyCode?.trim().toUpperCase() ||
        operator.fx?.currencyCode?.trim().toUpperCase() ||
        "USD";
      const productType = operator.data || operator.bundle ? "data_bundle" : "airtime";
      const networkCode = `reloadly-op-${operatorId}`;
      const networkName = operator.name?.trim() || `Reloadly Operator ${operatorId}`;

      const { data: networkRow, error: networkError } = await supabaseAdmin
        .from("data_topup_networks")
        .upsert(
          {
            provider_id: providerId,
            country_code: countryCode,
            network_code: networkCode,
            name: networkName,
            is_active: activate,
            provider_metadata: {
              source: "reloadly",
              operatorId,
              denominationType: operator.denominationType ?? null,
              data: Boolean(operator.data),
              bundle: Boolean(operator.bundle),
              pin: Boolean(operator.pin),
              destinationCurrencyCode: currency,
            },
          },
          {
            onConflict: "provider_id,country_code,network_code",
          }
        )
        .select("id")
        .single();

      if (networkError || !networkRow?.id) {
        throw new Error(`Unable to upsert Reloadly network ${networkName}.`);
      }

      summary.operatorsFetched += 1;
      summary.networksUpserted += 1;

      for (const amount of suggestedValues) {
        const productCode = `reloadly:${operatorId}:${productType}:${currency}:${amount.toFixed(2)}`;
        const displayName = `${networkName} ${formatDisplayAmount(currency, amount)}`;

        const { error: productError } = await supabaseAdmin
          .from("data_topup_products")
          .upsert(
            {
              provider_id: providerId,
              network_id: networkRow.id,
              product_type: productType,
              provider_product_code: productCode,
              display_name: displayName,
              description:
                productType === "airtime"
                  ? `Reloadly-powered airtime top-up for ${networkName}.`
                  : `Reloadly-powered data top-up for ${networkName}.`,
              currency,
              face_value: amount,
              retail_price: amount,
              cost_price: null,
              data_volume_label: null,
              validity_label: null,
              is_active:
                activate &&
                isTopupProductAllowedByCatalogRules({
                  countryCode,
                  currency,
                  retailPrice: amount,
                }),
              provider_metadata: {
                source: "reloadly",
                operatorId,
                amount,
                currency,
                productType,
              },
            },
            {
              onConflict: "provider_id,provider_product_code",
            }
          );

        if (productError) {
          throw new Error(
            `Unable to upsert Reloadly product ${productCode} for ${countryCode}.`
          );
        }

        summary.productsUpserted += 1;
      }
    }
  }

  return summary;
}

export const reloadlyTopupAggregatorAdapter: TopupAggregatorAdapter = {
  providerCode: "reloadly",
  async listProducts() {
    return [];
  },
  async purchaseBundle(input: PurchaseBundleInput): Promise<PurchaseBundleResult> {
    const operatorId = parseReloadlyOperatorId(
      input.providerProductCode,
      input.networkCode
    );
    const recipientPhone = buildReloadlyRecipientPhone({
      countryCode: input.countryCode,
      recipientMsisdn: input.recipientMsisdn,
    });
    const amount = Number(input.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Reloadly top-up requires a positive local amount.");
    }

    const response = await reloadlyFetchJson<ReloadlyTopupResponse>("/topups", {
      method: "POST",
      body: JSON.stringify({
        operatorId: Number(operatorId),
        amount,
        useLocalAmount: true,
        customIdentifier: input.providerRequestRef,
        recipientPhone,
      }),
    });

    const providerStatus = mapReloadlyStatus(
      response.status ?? response.transaction?.status ?? null
    );
    const providerTransactionRef =
      response.transactionId != null
        ? String(response.transactionId)
        : response.transaction?.transactionId != null
        ? String(response.transaction.transactionId)
        : response.operatorTransactionId ??
          response.transaction?.operatorTransactionId ??
          null;

    return {
      accepted: providerStatus !== "failed",
      providerTransactionRef,
      providerStatus,
      providerMessage: response.message ?? response.code ?? null,
      raw: response as Record<string, unknown>,
    };
  },
  async getFulfillmentStatus(
    providerTransactionRef: string
  ): Promise<FulfillmentStatusResult> {
    const response = await reloadlyFetchJson<ReloadlyTopupResponse>(
      `/topups/${encodeURIComponent(providerTransactionRef)}/status`
    );

    return {
      providerStatus: mapReloadlyStatusForFulfillment(response.status),
      providerRequestRef: null,
      providerTransactionRef,
      providerMessage: response.message ?? response.code ?? null,
      raw: response as Record<string, unknown>,
    };
  },
  async parseWebhook(
    payload,
    headers,
    rawBody
  ): Promise<FulfillmentStatusResult | null> {
    const requestSignature = readTrimmedEnv("TOPUP_RELOADLY_WEBHOOK_SECRET")
      ? headers.get("x-reloadly-signature")?.trim() ?? null
      : null;
    const requestTimestamp = headers
      .get("x-reloadly-request-timestamp")
      ?.trim();

    if (!rawBody || !requestSignature || !requestTimestamp) {
      return null;
    }

    const verified = verifyReloadlyWebhookSignature({
      rawBody,
      requestSignature,
      requestTimestamp,
    });

    if (!verified) {
      return null;
    }

    return parseReloadlyWebhookPayload(payload);
  },
};
