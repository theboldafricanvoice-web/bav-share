import { authenticateTopupRequest } from "@/lib/topup/auth";
import { isTopupProductAllowedByCatalogRules } from "@/lib/topup/catalogRules";
import {
  compareTopupProviderPriority,
  normalizeTopupComparableText,
} from "@/lib/topup/providers/preference";
import { jsonError, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticateTopupRequest(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const countryCode = readString(searchParams.get("countryCode"));
    const networkId = readString(searchParams.get("networkId"));

    const { data: countryRows, error: countriesError } = await auth.supabaseAdmin
      .from("data_topup_networks")
      .select("country_code")
      .eq("is_active", true)
      .order("country_code", { ascending: true });

    if (countriesError) {
      console.error("GET /api/topup/catalog countries error:", countriesError);
      return jsonError("Unable to load supported top-up countries.", 500);
    }

    let networksQuery = auth.supabaseAdmin
      .from("data_topup_networks")
      .select(`
        id,
        provider_id,
        country_code,
        network_code,
        name,
        is_active,
        data_topup_providers:provider_id (
          code
        )
      `)
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (countryCode) {
      networksQuery = networksQuery.eq("country_code", countryCode);
    }

    const { data: networks, error: networksError } = await networksQuery;

    if (networksError) {
      console.error("GET /api/topup/catalog networks error:", networksError);
      return jsonError("Unable to load top-up networks.", 500);
    }

    const preferredNetworksMap = new Map<string, any>();
    for (const network of networks ?? []) {
      const providerCode = Array.isArray((network as any).data_topup_providers)
        ? (network as any).data_topup_providers[0]?.code ?? null
        : (network as any).data_topup_providers?.code ?? null;
      const key = `${String(network.country_code ?? "").trim().toUpperCase()}::${normalizeTopupComparableText(
        String(network.name ?? "")
      )}`;
      const current = preferredNetworksMap.get(key);

      if (!current) {
        preferredNetworksMap.set(key, network);
        continue;
      }

      const currentProviderCode = Array.isArray((current as any).data_topup_providers)
        ? (current as any).data_topup_providers[0]?.code ?? null
        : (current as any).data_topup_providers?.code ?? null;

      if (compareTopupProviderPriority(providerCode, currentProviderCode) < 0) {
        preferredNetworksMap.set(key, network);
      }
    }

    const preferredNetworks = Array.from(preferredNetworksMap.values()).map((network) => ({
      id: network.id,
      provider_id: network.provider_id,
      country_code: network.country_code,
      network_code: network.network_code,
      name: network.name,
      is_active: network.is_active,
    }));
    const allowedNetworkIds = new Set(preferredNetworks.map((network) => network.id));

    let productsQuery = auth.supabaseAdmin
      .from("data_topup_products")
      .select(`
        id,
        provider_id,
        network_id,
        product_type,
        provider_product_code,
        display_name,
        description,
        currency,
        face_value,
        retail_price,
        cost_price,
        data_volume_label,
        validity_label,
        is_active
      `)
      .eq("is_active", true)
      .order("product_type", { ascending: true })
      .order("retail_price", { ascending: true })
      .order("display_name", { ascending: true });

    if (networkId) {
      productsQuery = productsQuery.eq("network_id", networkId);
    }

    const { data: products, error: productsError } = await productsQuery;

    if (productsError) {
      console.error("GET /api/topup/catalog products error:", productsError);
      return jsonError("Unable to load top-up products.", 500);
    }

    const preferredProducts = (products ?? []).filter(
      (product) =>
        allowedNetworkIds.has(product.network_id) &&
        isTopupProductAllowedByCatalogRules({
          currency: product.currency,
          retailPrice: product.retail_price,
          countryCode:
            preferredNetworks.find((network) => network.id === product.network_id)?.country_code ?? null,
        })
    );

    const allowedProductNetworkIds = new Set(preferredProducts.map((product) => product.network_id));
    const visibleNetworks = preferredNetworks.filter((network) =>
      allowedProductNetworkIds.has(network.id)
    );

    const countries = Array.from(
      new Set(
        (countryRows ?? [])
          .map((row) => row.country_code)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim().toUpperCase())
      )
    );

    return NextResponse.json({
      countries,
      networks: visibleNetworks,
      products: preferredProducts,
    });
  } catch (error) {
    console.error("GET /api/topup/catalog error:", error);
    return jsonError("Unable to load top-up catalog.", 500);
  }
}
