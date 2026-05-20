import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillPaymentInput,
  BillPaymentResult,
  BillPaymentStatusResult,
  BillsPayProviderAdapter,
  CustomerValidationResult,
  NormalizedBillsPayBiller,
} from "@/lib/billsPay/providers/base";

const RELOADLY_AUTH_URL = "https://auth.reloadly.com/oauth/token";

type ReloadlyEnvironment = "live" | "sandbox";

type ReloadlyBillerType =
  | "ELECTRICITY_BILL_PAYMENT"
  | "WATER_BILL_PAYMENT"
  | "INTERNET_BILL_PAYMENT"
  | "TV_BILL_PAYMENT";

type ReloadlyBiller = {
  id?: number | string;
  name?: string;
  countryCode?: string;
  countryName?: string;
  type?: string;
  serviceType?: string;
  localAmountSupported?: boolean;
  localTransactionCurrencyCode?: string;
  minLocalTransactionAmount?: number | null;
  maxLocalTransactionAmount?: number | null;
  localTransactionFee?: number | null;
  localTransactionFeeCurrencyCode?: string;
  internationalAmountSupported?: boolean;
  internationalTransactionCurrencyCode?: string;
  minInternationalTransactionAmount?: number | null;
  maxInternationalTransactionAmount?: number | null;
  internationalTransactionFee?: number | null;
  internationalTransactionFeeCurrencyCode?: string;
  fx?: {
    rate?: number;
    currencyCode?: string;
  } | null;
};

type ReloadlyBillPaymentResponse = {
  id?: number | string;
  status?: string | null;
  referenceId?: string | null;
  code?: string | null;
  message?: string | null;
  submittedAt?: string | null;
  finalStatusAvailabilityAt?: string | null;
};

type ReloadlyTransactionListResponse = {
  content?: Array<{
    code?: string | null;
    message?: string | null;
    transaction?: {
      id?: number | string;
      status?: string | null;
      referenceId?: string | null;
      amount?: number | null;
      amountCurrencyCode?: string | null;
      deliveryAmount?: number | null;
      deliveryAmountCurrencyCode?: string | null;
      submittedAt?: string | null;
      billDetails?: {
        type?: string | null;
        billerId?: number | string | null;
        billerName?: string | null;
        billerCountryCode?: string | null;
        serviceType?: string | null;
        completedAt?: string | null;
        subscriberDetails?: Record<string, unknown> | null;
        pinDetails?: Record<string, unknown> | null;
      } | null;
    } | null;
  }>;
};

type ReloadlyTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type ReloadlyCatalogCategoryConfig = {
  categoryCode: string;
  requiredFields: string[];
  supportsLookup: boolean;
};

const RELOADLY_BILLER_TYPE_TO_CATEGORY: Record<
  ReloadlyBillerType,
  ReloadlyCatalogCategoryConfig
> = {
  ELECTRICITY_BILL_PAYMENT: {
    categoryCode: "electricity",
    requiredFields: ["meter_number"],
    supportsLookup: false,
  },
  WATER_BILL_PAYMENT: {
    categoryCode: "water",
    requiredFields: ["account_number"],
    supportsLookup: false,
  },
  INTERNET_BILL_PAYMENT: {
    categoryCode: "internet",
    requiredFields: ["account_number"],
    supportsLookup: false,
  },
  TV_BILL_PAYMENT: {
    categoryCode: "cable_tv",
    requiredFields: ["account_number"],
    supportsLookup: false,
  },
};

let reloadlyBillsPayTokenCache: ReloadlyTokenCache | null = null;

function readTrimmedEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

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

function getReloadlyBillsPayEnvironment(): ReloadlyEnvironment {
  const raw =
    readTrimmedEnv("BILLS_PAY_RELOADLY_ENVIRONMENT")?.toLowerCase() ??
    readTrimmedEnv("TOPUP_RELOADLY_ENVIRONMENT")?.toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

function getReloadlyBillsPayBaseUrl(environment = getReloadlyBillsPayEnvironment()) {
  return environment === "live"
    ? "https://utilities.reloadly.com"
    : "https://utilities-sandbox.reloadly.com";
}

function getReloadlyBillsPayAudience(
  environment = getReloadlyBillsPayEnvironment()
) {
  return environment === "live"
    ? "https://utilities.reloadly.com"
    : "https://utilities-sandbox.reloadly.com";
}

function getReloadlyBillsPayConfig() {
  const clientId =
    readTrimmedEnv("BILLS_PAY_RELOADLY_CLIENT_ID") ??
    readTrimmedEnv("TOPUP_RELOADLY_CLIENT_ID");
  const clientSecret =
    readTrimmedEnv("BILLS_PAY_RELOADLY_CLIENT_SECRET") ??
    readTrimmedEnv("TOPUP_RELOADLY_CLIENT_SECRET");

  if (!clientId) {
    throw new Error("Missing BILLS_PAY_RELOADLY_CLIENT_ID.");
  }

  if (!clientSecret) {
    throw new Error("Missing BILLS_PAY_RELOADLY_CLIENT_SECRET.");
  }

  const environment = getReloadlyBillsPayEnvironment();

  return {
    clientId,
    clientSecret,
    environment,
    baseUrl: getReloadlyBillsPayBaseUrl(environment),
    audience: getReloadlyBillsPayAudience(environment),
  };
}

async function getReloadlyBillsPayAccessToken() {
  const now = Date.now();
  if (
    reloadlyBillsPayTokenCache &&
    reloadlyBillsPayTokenCache.expiresAt - 30_000 > now
  ) {
    return reloadlyBillsPayTokenCache.accessToken;
  }

  const config = getReloadlyBillsPayConfig();
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
        "Reloadly bills-pay authentication failed."
    );
  }

  reloadlyBillsPayTokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, Number(payload.expires_in ?? 0)) * 1000,
  };

  return reloadlyBillsPayTokenCache.accessToken;
}

async function reloadlyBillsPayFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getReloadlyBillsPayAccessToken();
  const config = getReloadlyBillsPayConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const responseText = await response.text().catch(() => "");
  let payload: T | null = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as T;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const maybeMessage =
      payload && typeof payload === "object"
        ? ((payload as Record<string, unknown>).message as string | undefined) ??
          ((payload as Record<string, unknown>).error as string | undefined)
        : undefined;

    throw new Error(
      maybeMessage ??
        responseText?.trim() ??
        `Reloadly bills-pay request failed with ${response.status}.`
    );
  }

  return payload as T;
}

function mapReloadlyBillsPayStatus(
  status: string | null | undefined
): BillPaymentResult["providerStatus"] {
  const normalized = status?.trim().toUpperCase() ?? "";

  if (normalized === "SUCCESSFUL") return "paid_to_biller";
  if (normalized === "PROCESSING" || normalized === "PENDING") return "pending";
  if (normalized === "FAILED" || normalized === "REJECTED") return "failed";
  return "unknown";
}

function mapReloadlyBillsPayStatusResult(
  status: string | null | undefined
): BillPaymentStatusResult["providerStatus"] {
  const mapped = mapReloadlyBillsPayStatus(status);
  if (mapped === "accepted") return "pending";
  return mapped;
}

function parseReloadlyBillerId(billerCode: string) {
  const parsed = billerCode.match(/^reloadly:(\d+)$/i)?.[1] ?? null;
  if (!parsed) {
    throw new Error(`Reloadly biller code ${billerCode} is invalid.`);
  }
  return Number(parsed);
}

function getReloadlyCatalogTypes() {
  return Object.keys(
    RELOADLY_BILLER_TYPE_TO_CATEGORY
  ) as Array<ReloadlyBillerType>;
}

function buildReloadlyBillerDescription(biller: ReloadlyBiller) {
  const serviceType = readStringValue(biller.serviceType);
  const countryName = readStringValue(biller.countryName);
  const parts = [serviceType, countryName].filter(Boolean);
  return parts.length > 0
    ? `Reloadly-powered ${parts.join(" ")} bill payment.`
    : "Reloadly-powered utility bill payment.";
}

function normalizeReloadlyBiller(
  providerCode: string,
  biller: ReloadlyBiller
): NormalizedBillsPayBiller | null {
  const rawType = readStringValue(biller.type)?.toUpperCase() as
    | ReloadlyBillerType
    | undefined;
  if (!rawType || !(rawType in RELOADLY_BILLER_TYPE_TO_CATEGORY)) {
    return null;
  }

  const config = RELOADLY_BILLER_TYPE_TO_CATEGORY[rawType];
  const billerId = readNumberValue(biller.id);
  const countryCode = readStringValue(biller.countryCode)?.toUpperCase();
  const name = readStringValue(biller.name);
  const currency =
    readStringValue(biller.localTransactionCurrencyCode)?.toUpperCase() ??
    readStringValue(biller.internationalTransactionCurrencyCode)?.toUpperCase() ??
    readStringValue(biller.fx?.currencyCode)?.toUpperCase();

  if (!billerId || !countryCode || !name || !currency) {
    return null;
  }

  return {
    providerCode,
    categoryCode: config.categoryCode,
    countryCode,
    billerCode: `reloadly:${billerId}`,
    name,
    description: buildReloadlyBillerDescription(biller),
    currency,
    supportsLookup: config.supportsLookup,
    supportsFixedAmount: false,
    supportsVariableAmount: Boolean(
      biller.localAmountSupported ?? biller.internationalAmountSupported ?? true
    ),
    minAmount:
      readNumberValue(biller.minLocalTransactionAmount) ??
      readNumberValue(biller.minInternationalTransactionAmount),
    maxAmount:
      readNumberValue(biller.maxLocalTransactionAmount) ??
      readNumberValue(biller.maxInternationalTransactionAmount),
    requiredFields: config.requiredFields,
    metadata: {
      source: "reloadly",
      reloadlyBillerId: billerId,
      reloadlyType: rawType,
      serviceType: readStringValue(biller.serviceType),
      localAmountSupported: Boolean(biller.localAmountSupported),
      internationalAmountSupported: Boolean(biller.internationalAmountSupported),
      localFee: readNumberValue(biller.localTransactionFee),
      localFeeCurrency:
        readStringValue(biller.localTransactionFeeCurrencyCode)?.toUpperCase() ??
        null,
      internationalFee: readNumberValue(biller.internationalTransactionFee),
      internationalFeeCurrency:
        readStringValue(biller.internationalTransactionFeeCurrencyCode)?.toUpperCase() ??
        null,
    },
  };
}

async function fetchReloadlyBillersByCountry(countryCode: string) {
  const normalizedCountryCode = countryCode.trim().toUpperCase();
  const billers: ReloadlyBiller[] = [];
  const skippedTypes: string[] = [];

  for (const type of getReloadlyCatalogTypes()) {
    const query = new URLSearchParams({
      id: "0",
      name: "0",
      type,
      serviceType: "0",
      countryISOCode: normalizedCountryCode,
      page: "0",
      size: "200",
    });
    try {
      const response = await reloadlyBillsPayFetchJson<ReloadlyBiller[]>(
        `/billers?${query.toString()}`
      );
      billers.push(...(response ?? []));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("406")) {
        skippedTypes.push(`${normalizedCountryCode}:${type}:${message}`);
        continue;
      }

      throw error;
    }
  }

  return {
    billers,
    skippedTypes,
  };
}

async function ensureReloadlyBillsPayProviderRow(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("bills_pay_providers")
    .upsert(
      {
        code: "reloadly",
        name: "Reloadly Utility Payments",
        is_active: true,
        capabilities: {
          mode: "live_api",
          catalogSource: "reloadly",
          supportsLookup: false,
          supportsVariableAmount: true,
          supportsCatalogSync: true,
          supportsBillPayment: true,
        },
      },
      {
        onConflict: "code",
      }
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error("Unable to upsert the Reloadly bills-pay provider row.");
  }

  return data.id as string;
}

async function getBillsPayCategoriesByCode(supabaseAdmin: SupabaseClient) {
  const categoryCodes = Array.from(
    new Set(
      Object.values(RELOADLY_BILLER_TYPE_TO_CATEGORY).map(
        (value) => value.categoryCode
      )
    )
  );

  const { data, error } = await supabaseAdmin
    .from("bills_pay_categories")
    .select("id, code")
    .in("code", categoryCodes);

  if (error) {
    throw new Error("Unable to load bills-pay categories for Reloadly sync.");
  }

  return new Map(
    (data ?? []).map((row) => [String(row.code), String(row.id)])
  );
}

export async function syncReloadlyBillsPayCatalog(params: {
  supabaseAdmin: SupabaseClient;
  countryCodes: string[];
  activate?: boolean;
}) {
  const { supabaseAdmin } = params;
  const providerId = await ensureReloadlyBillsPayProviderRow(supabaseAdmin);
  const categoryIdsByCode = await getBillsPayCategoriesByCode(supabaseAdmin);
  const activate = Boolean(params.activate);
  const normalizedCountries = Array.from(
    new Set(
      params.countryCodes
        .map((countryCode) => countryCode.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCountries.length === 0) {
    throw new Error("Reloadly bills-pay catalog sync requires at least one country code.");
  }

  const summary = {
    providerId,
    countries: normalizedCountries,
    activate,
    billersFetched: 0,
    billersUpserted: 0,
    skippedBillers: [] as string[],
  };

  for (const countryCode of normalizedCountries) {
    const { billers: rawBillers, skippedTypes } =
      await fetchReloadlyBillersByCountry(countryCode);

    summary.skippedBillers.push(...skippedTypes);

    for (const rawBiller of rawBillers) {
      const normalized = normalizeReloadlyBiller("reloadly", rawBiller);
      if (!normalized) {
        summary.skippedBillers.push(
          `${countryCode}: unable to normalize ${rawBiller.name ?? "unknown biller"}`
        );
        continue;
      }

      const categoryId = categoryIdsByCode.get(normalized.categoryCode);
      if (!categoryId) {
        summary.skippedBillers.push(
          `${countryCode}: missing category ${normalized.categoryCode} for ${normalized.name}`
        );
        continue;
      }

      const { error } = await supabaseAdmin.from("bills_pay_billers").upsert(
        {
          provider_id: providerId,
          category_id: categoryId,
          country_code: normalized.countryCode,
          biller_code: normalized.billerCode,
          name: normalized.name,
          description: normalized.description ?? null,
          currency: normalized.currency,
          supports_lookup: normalized.supportsLookup,
          supports_fixed_amount: normalized.supportsFixedAmount,
          supports_variable_amount: normalized.supportsVariableAmount,
          min_amount: normalized.minAmount ?? null,
          max_amount: normalized.maxAmount ?? null,
          required_fields: normalized.requiredFields,
          provider_metadata: normalized.metadata ?? {},
          is_active: activate,
        },
        {
          onConflict: "provider_id,country_code,biller_code",
        }
      );

      if (error) {
        throw new Error(
          `Unable to upsert Reloadly bills-pay biller ${normalized.name}.`
        );
      }

      summary.billersFetched += 1;
      summary.billersUpserted += 1;
    }
  }

  return summary;
}

export const reloadlyBillsPayProviderAdapter: BillsPayProviderAdapter = {
  providerCode: "reloadly",
  async getSupportedCountries(): Promise<string[]> {
    const countries = new Set<string>();

    for (const type of getReloadlyCatalogTypes()) {
      const query = new URLSearchParams({
        id: "0",
        name: "0",
        type,
        serviceType: "0",
        countryISOCode: "0",
        page: "0",
        size: "200",
      });
      const response = await reloadlyBillsPayFetchJson<ReloadlyBiller[]>(
        `/billers?${query.toString()}`
      );

      for (const biller of response ?? []) {
        const countryCode = readStringValue(biller.countryCode)?.toUpperCase();
        if (countryCode) countries.add(countryCode);
      }
    }

    return Array.from(countries).sort();
  },
  async getBillersByCountry(countryCode: string): Promise<NormalizedBillsPayBiller[]> {
    const { billers } = await fetchReloadlyBillersByCountry(countryCode);
    return billers
      .map((biller) => normalizeReloadlyBiller("reloadly", biller))
      .filter((value): value is NormalizedBillsPayBiller => Boolean(value));
  },
  async validateCustomer(input): Promise<CustomerValidationResult> {
    return {
      valid: true,
      customerName: null,
      providerMessage:
        "Reloadly does not provide a separate pre-payment account lookup through this integration path. Validation will happen during bill submission.",
      raw: {
        adapter: "reloadly",
        billerCode: input.billerCode,
        countryCode: input.countryCode,
        accountReference: input.accountReference,
      },
    };
  },
  async payBill(input: BillPaymentInput): Promise<BillPaymentResult> {
    const response = await reloadlyBillsPayFetchJson<ReloadlyBillPaymentResponse>(
      "/pay",
      {
        method: "POST",
        body: JSON.stringify({
          subscriberAccountNumber: input.accountReference,
          amount: Number(input.amount),
          billerId: parseReloadlyBillerId(input.billerCode),
          useLocalAmount: true,
          referenceId: input.providerRequestRef,
        }),
      }
    );

    return {
      accepted: mapReloadlyBillsPayStatus(response.status) !== "failed",
      providerTransactionRef:
        response.id != null ? String(response.id) : null,
      providerStatus: mapReloadlyBillsPayStatus(response.status),
      providerMessage: response.message ?? response.code ?? null,
      raw: response as Record<string, unknown>,
    };
  },
  async checkTransactionStatus(
    providerTransactionId: string
  ): Promise<BillPaymentStatusResult> {
    const response = await reloadlyBillsPayFetchJson<ReloadlyTransactionListResponse>(
      "/transactions?page=0&size=200"
    );

    const match = (response.content ?? []).find((entry) => {
      const id = entry.transaction?.id;
      return id != null && String(id) === providerTransactionId;
    });

    if (!match?.transaction) {
      return {
        providerStatus: "unknown",
        providerTransactionRef: providerTransactionId,
        providerMessage: "Reloadly utility transaction was not found in the recent transaction feed.",
        raw: (response ?? {}) as Record<string, unknown>,
      };
    }

    return {
      providerStatus: mapReloadlyBillsPayStatusResult(match.transaction.status),
      providerRequestRef: readStringValue(match.transaction.referenceId),
      providerTransactionRef:
        match.transaction.id != null ? String(match.transaction.id) : providerTransactionId,
      providerMessage: readStringValue(match.message) ?? readStringValue(match.code),
      raw: match as Record<string, unknown>,
    };
  },
  async parseWebhook() {
    return null;
  },
};
