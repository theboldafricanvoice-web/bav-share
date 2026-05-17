type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const checkout = readSearchParam(resolvedSearchParams, "checkout");
  const status = readSearchParam(resolvedSearchParams, "status");
  const orderRef = readSearchParam(resolvedSearchParams, "orderRef");
  const paymentReference = readSearchParam(
    resolvedSearchParams,
    "paymentReference"
  );
  const isTopupSuccess = checkout === "topup" && status === "success";
  const isTopupCancelled = checkout === "topup" && status === "cancelled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="max-w-xl rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-500">
          BAV Network
        </p>
        <h1 className="mt-3 text-3xl font-bold text-neutral-900">
          {isTopupSuccess
            ? "Thank You For Your Payment"
            : isTopupCancelled
            ? "Payment Cancelled"
            : "BAV Share"}
        </h1>
        {isTopupSuccess ? (
          <div className="mt-4 space-y-3 text-neutral-600">
            <p>
              Your BAV Top-Up payment was received successfully. We are now
              processing your airtime or data order for delivery.
            </p>
            {orderRef ? (
              <p className="text-sm text-neutral-500">Order reference: {orderRef}</p>
            ) : null}
            {paymentReference ? (
              <p className="text-sm text-neutral-500">
                Payment reference: {paymentReference}
              </p>
            ) : null}
          </div>
        ) : isTopupCancelled ? (
          <div className="mt-4 space-y-3 text-neutral-600">
            <p>
              Your checkout was cancelled before payment completed. You can
              return to BAV and restart the top-up whenever you are ready.
            </p>
            {orderRef ? (
              <p className="text-sm text-neutral-500">Order reference: {orderRef}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-neutral-600">
            This site powers public shared-message previews for BAV Network.
          </p>
        )}
      </div>
    </main>
  );
}
