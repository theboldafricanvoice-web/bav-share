export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="max-w-xl rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-500">
          BAV Network
        </p>
        <h1 className="mt-3 text-3xl font-bold text-neutral-900">
          BAV Share
        </h1>
        <p className="mt-4 text-neutral-600">
          This site powers public shared-message previews for BAV Network.
        </p>
      </div>
    </main>
  );
}