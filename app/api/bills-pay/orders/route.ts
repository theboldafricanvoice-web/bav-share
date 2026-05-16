import { authenticateBillsPayRequest } from "@/lib/billsPay/auth";
import { toCanonicalBillsPayOrderStatus } from "@/lib/billsPay/types";
import { buildBillsPayOrderRef, jsonError, readNumber, readString } from "@/lib/billsPay/utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CreateBillsPayOrderBody = {
  billerId?: string;
  countryCode?: string;
  amount?: number | string;
  recipientName?: string;
  payerNote?: string;
  customerReference?: string;
  accountNumber?: string;
  meterNumber?: string;
  studentId?: string;
  serviceNumber?: string;
  validationSnapshot?: Record<string, unknown>;
};

function isCreateBillsPayOrderBody(value: unknown): value is CreateBillsPayOrderBody {
  return !!value && typeof value === "object";
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateBillsPayRequest(request);
    if (!auth.ok) return auth.response;

    let rawPayload: unknown;
    try {
      rawPayload = await request.json();
    } catch {
      return jsonError("Invalid JSON body.");
    }

    if (!isCreateBillsPayOrderBody(rawPayload)) {
      return jsonError("Request body is missing required fields.");
    }

    const billerId = readString(rawPayload.billerId);
    const countryCode = readString(rawPayload.countryCode);
    const amount = readNumber(rawPayload.amount);
    const recipientName = readString(rawPayload.recipientName);
    const payerNote = readString(rawPayload.payerNote);
    const customerReference = readString(rawPayload.customerReference);
    const accountNumber = readString(rawPayload.accountNumber);
    const meterNumber = readString(rawPayload.meterNumber);
    const studentId = readString(rawPayload.studentId);
    const serviceNumber = readString(rawPayload.serviceNumber);

    if (!billerId || !countryCode || amount == null) {
      return jsonError("billerId, countryCode, and amount are required.");
    }

    if (amount < 0) {
      return jsonError("amount must be zero or greater.");
    }

    const primaryReference =
      customerReference ?? accountNumber ?? meterNumber ?? studentId ?? serviceNumber;

    if (!primaryReference) {
      return jsonError(
        "A customerReference, accountNumber, meterNumber, studentId, or serviceNumber is required."
      );
    }

    const { data: biller, error: billerError } = await auth.supabaseAdmin
      .from("bills_pay_billers")
      .select(`
        id,
        provider_id,
        category_id,
        country_code,
        biller_code,
        name,
        description,
        currency,
        supports_lookup,
        supports_fixed_amount,
        supports_variable_amount,
        min_amount,
        max_amount,
        required_fields,
        bills_pay_categories:category_id (
          code,
          name
        ),
        bills_pay_providers:provider_id (
          code,
          name
        )
      `)
      .eq("id", billerId)
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .maybeSingle();

    if (billerError) {
      console.error("POST /api/bills-pay/orders biller lookup error:", billerError);
      return jsonError("Unable to validate the selected biller.", 500);
    }

    if (!biller) {
      return jsonError("Selected biller was not found.", 404);
    }

    if (biller.min_amount != null && amount < Number(biller.min_amount)) {
      return jsonError(`Amount is below the allowed minimum for ${biller.name}.`);
    }

    if (biller.max_amount != null && amount > Number(biller.max_amount)) {
      return jsonError(`Amount is above the allowed maximum for ${biller.name}.`);
    }

    const providerCode = Array.isArray((biller as any).bills_pay_providers)
      ? (biller as any).bills_pay_providers[0]?.code ?? "manual"
      : (biller as any).bills_pay_providers?.code ?? "manual";
    const providerName = Array.isArray((biller as any).bills_pay_providers)
      ? (biller as any).bills_pay_providers[0]?.name ?? null
      : (biller as any).bills_pay_providers?.name ?? null;
    const categoryCode = Array.isArray((biller as any).bills_pay_categories)
      ? (biller as any).bills_pay_categories[0]?.code ?? null
      : (biller as any).bills_pay_categories?.code ?? null;
    const categoryName = Array.isArray((biller as any).bills_pay_categories)
      ? (biller as any).bills_pay_categories[0]?.name ?? null
      : (biller as any).bills_pay_categories?.name ?? null;

    const orderRef = buildBillsPayOrderRef();
    const nowIso = new Date().toISOString();
    const serviceFee = 0;
    const costPrice = amount;
    const sellingPrice = amount + serviceFee;
    const margin = sellingPrice - costPrice;

    const lockedBillerSnapshot = {
      billerId: biller.id,
      providerId: biller.provider_id,
      providerCode,
      providerName,
      categoryId: biller.category_id,
      categoryCode,
      categoryName,
      billerCode: biller.biller_code,
      billerName: biller.name,
      description: biller.description ?? null,
      currency: biller.currency,
      supportsLookup: biller.supports_lookup,
      supportsFixedAmount: biller.supports_fixed_amount,
      supportsVariableAmount: biller.supports_variable_amount,
      minAmount: biller.min_amount,
      maxAmount: biller.max_amount,
      lockedAt: nowIso,
    };

    const { data: order, error: orderError } = await auth.supabaseAdmin
      .from("bills_pay_orders")
      .insert({
        user_id: auth.user.id,
        order_ref: orderRef,
        provider_id: biller.provider_id,
        category_id: biller.category_id,
        biller_id: biller.id,
        recipient_name: recipientName ?? null,
        payer_note: payerNote ?? null,
        country_code: countryCode,
        customer_reference: customerReference ?? primaryReference,
        account_number: accountNumber ?? null,
        meter_number: meterNumber ?? null,
        student_id: studentId ?? null,
        service_number: serviceNumber ?? null,
        lookup_snapshot:
          rawPayload.validationSnapshot && typeof rawPayload.validationSnapshot === "object"
            ? rawPayload.validationSnapshot
            : {},
        locked_biller_snapshot: lockedBillerSnapshot,
        bill_amount: amount,
        service_fee: serviceFee,
        selling_price: sellingPrice,
        cost_price: costPrice,
        margin,
        currency: biller.currency,
        status: "pending_payment",
        payment_status: "initiated",
        fulfillment_status: "not_started",
        aggregator_provider: providerCode,
      })
      .select(`
        id,
        order_ref,
        recipient_name,
        country_code,
        customer_reference,
        bill_amount,
        service_fee,
        selling_price,
        cost_price,
        margin,
        currency,
        status,
        payment_status,
        fulfillment_status,
        created_at
      `)
      .single();

    if (orderError || !order) {
      console.error("POST /api/bills-pay/orders insert error:", orderError);
      return jsonError("Unable to create the bills-pay order.", 500);
    }

    const { error: eventError } = await auth.supabaseAdmin
      .from("bills_pay_order_events")
      .insert({
        order_id: order.id,
        actor_type: "user",
        actor_id: auth.user.id,
        event_type: "order_created",
        message: "Bills-pay order created and awaiting payment.",
        payload: {
          orderRef,
          billerId,
          countryCode,
          amount,
          customerReference: customerReference ?? primaryReference,
        },
      });

    if (eventError) {
      console.error("POST /api/bills-pay/orders event insert error:", eventError);
    }

    return NextResponse.json({
      order: {
        id: order.id,
        orderRef: order.order_ref,
        status: toCanonicalBillsPayOrderStatus(order.status),
        rawStatus: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        recipientName: order.recipient_name,
        countryCode: order.country_code,
        customerReference: order.customer_reference,
        billAmount: order.bill_amount,
        serviceFee: order.service_fee,
        sellingPrice: order.selling_price,
        costPrice: order.cost_price,
        margin: order.margin,
        currency: order.currency,
        createdAt: order.created_at,
      },
    });
  } catch (error) {
    console.error("POST /api/bills-pay/orders error:", error);
    return jsonError("Unable to create bills-pay order.", 500);
  }
}
