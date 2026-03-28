export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-500">
          BAV Network
        </p>
        <h1 className="mt-3 text-2xl font-bold text-neutral-900">
          Shared message not found
        </h1>
        <p className="mt-3 text-neutral-600">
          This link may be invalid, inactive, or expired.
        </p>
      </div>
    </main>
  );
}