import { authenticateTopupRequest } from "@/lib/topup/auth";
import { isTopupProductAllowedByCatalogRules } from "@/lib/topup/catalogRules";
import {
  compareTopupProviderPriority,
  normalizeTopupComparableText,
} from "@/lib/topup/providers/preference";
import { toCanonicalTopupOrderStatus } from "@/lib/topup/types";
import { buildOrderRef, jsonError, normalizeMsisdn, readString } from "@/lib/topup/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CreateTopupOrderBody = {
  networkId?: string;
  productId?: string;
  recipientMsisdn?: string;
  recipientName?: string;
  countryCode?: string;
};

function isCreateTopupOrderBody(value: unknown): value is CreateTopupOrderBody {
  if (!value || typeof value !== "object") return false;
  return true;
}

function readProviderCode(record: any) {
  return Array.isArray(record?.data_topup_providers)
    ? record.data_topup_providers[0]?.code ?? "manual"
    : record?.data_topup_providers?.code ?? "manual";
}

function readProviderName(record: any) {
  return Array.isArray(record?.data_topup_providers)
    ? record.data_topup_providers[0]?.name ?? null
    : record?.data_topup_providers?.name ?? null;
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateTopupRequest(request);
    if (!auth.ok) return auth.response;

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.");
    }

    if (!isCreateTopupOrderBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const networkId = readString(rawPayload.networkId);
    const productId = readString(rawPayload.productId);
    const recipientMsisdn = readString(rawPayload.recipientMsisdn);
    const recipientName = readString(rawPayload.recipientName);
    const countryCode = readString(rawPayload.countryCode);

    if (!networkId || !productId || !recipientMsisdn || !countryCode) {
      return jsonError("networkId, productId, recipientMsisdn, and countryCode are required.");
    }

    const normalizedMsisdn = normalizeMsisdn(recipientMsisdn);
    if (normalizedMsisdn.length < 7) {
      return jsonError("recipientMsisdn must be a valid phone number.");
    }

    const { data: product, error: productError } = await auth.supabaseAdmin
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
        is_active,
        data_topup_providers:provider_id (
          code,
          name
        )
      `)
      .eq("id", productId)
      .eq("network_id", networkId)
      .eq("is_active", true)
      .maybeSingle();

    if (productError) {
      console.error("POST /api/topup/orders product lookup error:", productError);
      return jsonError("Unable to validate the selected top-up product.", 500);
    }

    if (!product) {
      return jsonError("Selected top-up product was not found.", 404);
    }

    const { data: network, error: networkError } = await auth.supabaseAdmin
      .from("data_topup_networks")
      .select("id, country_code, network_code, name, is_active")
      .eq("id", networkId)
      .eq("is_active", true)
      .maybeSingle();

    if (networkError) {
      console.error("POST /api/topup/orders network lookup error:", networkError);
      return jsonError("Unable to validate the selected network.", 500);
    }

    if (!network) {
      return jsonError("Selected top-up network was not found.", 404);
    }

    if (
      !isTopupProductAllowedByCatalogRules({
        countryCode: network.country_code,
        currency: product.currency,
        retailPrice: product.retail_price,
      })
    ) {
      return jsonError(
        "Selected top-up amount is no longer available for this country. Please choose SLE 40 or higher.",
        400
      );
    }

    const selectedProviderCode = readProviderCode(product as any);
    const selectedProviderName = readProviderName(product as any);

    const { data: fallbackProductRows, error: fallbackProductsError } = await auth.supabaseAdmin
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
        is_active,
        data_topup_providers:provider_id (
          code,
          name
        ),
        data_topup_networks:network_id (
          id,
          country_code,
          network_code,
          name
        )
      `)
      .eq("is_active", true)
      .eq("product_type", product.product_type ?? "data_bundle")
      .eq("currency", product.currency)
      .eq("face_value", product.face_value)
      .eq("retail_price", product.retail_price);

    if (fallbackProductsError) {
      console.error("POST /api/topup/orders fallback lookup error:", fallbackProductsError);
      return jsonError("Unable to build the top-up fulfillment route.", 500);
    }

    const fallbackCandidates = (fallbackProductRows ?? [])
      .filter((candidate: any) => candidate.id !== product.id)
      .filter((candidate: any) => {
        const candidateNetwork = Array.isArray(candidate.data_topup_networks)
          ? candidate.data_topup_networks[0] ?? null
          : candidate.data_topup_networks ?? null;
        const candidateProviderCode = readProviderCode(candidate);
        return (
          candidateNetwork?.country_code === network.country_code &&
          candidateProviderCode !== selectedProviderCode &&
          normalizeTopupComparableText(candidateNetwork?.name ?? "") ===
            normalizeTopupComparableText(network.name)
        );
      })
      .sort((left: any, right: any) =>
        compareTopupProviderPriority(readProviderCode(left), readProviderCode(right))
      )
      .map((candidate: any) => {
        const candidateNetwork = Array.isArray(candidate.data_topup_networks)
          ? candidate.data_topup_networks[0] ?? null
          : candidate.data_topup_networks ?? null;
        return {
          productId: candidate.id,
          networkId: candidate.network_id,
          providerId: candidate.provider_id,
          providerCode: readProviderCode(candidate),
          providerName: readProviderName(candidate),
          productType: candidate.product_type ?? "data_bundle",
          providerProductCode: candidate.provider_product_code,
          displayName: candidate.display_name,
          description: candidate.description ?? null,
          currency: candidate.currency,
          faceValue: candidate.face_value,
          retailPrice: candidate.retail_price,
          costPrice: candidate.cost_price ?? null,
          dataVolumeLabel: candidate.data_volume_label ?? null,
          validityLabel: candidate.validity_label ?? null,
          networkName: candidateNetwork?.name ?? null,
          networkCode: candidateNetwork?.network_code ?? null,
          countryCode: candidateNetwork?.country_code ?? null,
        };
      })
      .slice(0, 2);

    const orderRef = buildOrderRef();
    const nowIso = new Date().toISOString();

    const lockedProductSnapshot = {
      productId: product.id,
      networkId: product.network_id,
      providerId: product.provider_id,
      providerCode: selectedProviderCode,
      providerName: selectedProviderName,
      productType: product.product_type ?? "data_bundle",
      providerProductCode: product.provider_product_code,
      displayName: product.display_name,
      description: product.description ?? null,
      currency: product.currency,
      faceValue: product.face_value,
      retailPrice: product.retail_price,
      costPrice: product.cost_price ?? null,
      dataVolumeLabel: product.data_volume_label ?? null,
      validityLabel: product.validity_label ?? null,
      networkName: network.name,
      networkCode: network.network_code,
      countryCode: network.country_code,
      fallbackCandidates,
      lockedAt: nowIso,
    };

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("data_topup_orders")
      .insert({
        user_id: auth.user.id,
        order_ref: orderRef,
        provider_id: product.provider_id,
        network_id: network.id,
        product_id: product.id,
        product_type: product.product_type ?? "data_bundle",
        recipient_name: recipientName ?? null,
        recipient_msisdn: normalizedMsisdn,
        recipient_phone_number: normalizedMsisdn,
        country_code: countryCode,
        country: network.country_code,
        operator_id: network.id,
        operator_name: network.name,
        data_plan_id: product.id,
        data_plan_name: product.display_name,
        data_amount:
          product.product_type === "airtime"
            ? null
            : product.data_volume_label ?? String(product.face_value ?? ""),
        validity_period:
          product.product_type === "airtime" ? null : product.validity_label ?? null,
        currency: product.currency,
        sale_amount: product.retail_price,
        cost_amount: product.cost_price ?? null,
        selling_price: product.retail_price,
        cost_price: product.cost_price ?? null,
        margin:
          product.cost_price == null ? null : Number(product.retail_price) - Number(product.cost_price),
        status: "pending_payment",
        payment_status: "initiated",
        fulfillment_status: "not_started",
        aggregator_provider: lockedProductSnapshot.providerCode ?? "manual",
        locked_product_snapshot: lockedProductSnapshot,
      })
      .select(`
        id,
        order_ref,
        recipient_name,
        recipient_phone_number,
        country,
        operator_id,
        operator_name,
        data_plan_id,
        data_plan_name,
        product_type,
        data_amount,
        validity_period,
        status,
        payment_status,
        fulfillment_status,
        sale_amount,
        selling_price,
        cost_price,
        margin,
        currency,
        created_at
      `)
      .single();

    if (orderError || !order) {
      console.error("POST /api/topup/orders insert error:", orderError);
      return jsonError("Unable to create the top-up order.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("data_topup_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "order_created",
        message: "Top-up order created and awaiting payment.",
        payload: {
          orderRef,
          networkId,
          productId,
          recipientName: recipientName ?? null,
          recipientMsisdn: normalizedMsisdn,
        },
      });

    if (eventError) {
      console.error("POST /api/topup/orders event insert error:", eventError);
    }

    return NextResponse.json({
      order: {
        id: order.id,
        orderRef: order.order_ref,
        status: toCanonicalTopupOrderStatus(order.status),
        rawStatus: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        recipientName: order.recipient_name,
        recipientPhoneNumber: order.recipient_phone_number,
        country: order.country,
        operatorId: order.operator_id,
        operatorName: order.operator_name,
        dataPlanId: order.data_plan_id,
        dataPlanName: order.data_plan_name,
        productType: order.product_type,
        dataAmount: order.data_amount,
        validityPeriod: order.validity_period,
        saleAmount: order.sale_amount,
        sellingPrice: order.selling_price ?? order.sale_amount,
        costPrice: order.cost_price,
        margin: order.margin,
        currency: order.currency,
        createdAt: order.created_at,
      },
    });
  } catch (error) {
    console.error("POST /api/topup/orders error:", error);
    return jsonError("Unable to create top-up order.", 500);
  }
}
