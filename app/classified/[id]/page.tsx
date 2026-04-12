import { createClient } from "@supabase/supabase-js";
import Image from "next/image";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SharedClassifiedRow = {
  id: string;
  token: string;
  title: string | null;
  description: string | null;
  price: string | number | null;
  location: string | null;
  featured_photo_url: string | null;
  seller_name: string | null;
  created_at: string | null;
  expires_at: string | null;
  is_active: boolean | null;
};

async function getSharedClassified(token: string): Promise<SharedClassifiedRow | null> {
  const { data, error } = await supabase
    .from("shared_classifieds")
    .select(`
      id,
      token,
      title,
      description,
      price,
      location,
      featured_photo_url,
      seller_name,
      created_at,
      expires_at,
      is_active
    `)
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("shared_classifieds lookup error:", error);
    return null;
  }

  if (!data) return null;

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }

  return data as SharedClassifiedRow;
}

export default async function SharedClassifiedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const item = await getSharedClassified(id);

  if (!item) {
    return (
      <main className="min-h-screen bg-[#f4f4f5] flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl rounded-[32px] bg-white shadow-xl p-8 text-center">
          <p className="text-sm tracking-[0.35em] text-neutral-500 font-semibold mb-6">
            BAV NETWORK
          </p>
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Shared classified not found
          </h1>
          <p className="text-lg text-neutral-500">
            This link may be invalid, inactive, or expired.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="rounded-[28px] overflow-hidden bg-white shadow-xl">
          {item.featured_photo_url ? (
            <div className="relative w-full bg-neutral-200" style={{ aspectRatio: "16 / 10" }}>
              <Image
                src={item.featured_photo_url}
                alt={item.title || "Classified image"}
                fill
                className="object-cover"
                priority
                unoptimized
              />
            </div>
          ) : null}

          <div className="p-6 md:p-8">
            <p className="text-sm tracking-[0.35em] text-neutral-500 font-semibold mb-4">
              BAV NETWORK
            </p>

            <h1 className="text-3xl md:text-4xl font-bold text-neutral-900 leading-tight">
              {item.title || "Untitled classified"}
            </h1>

            {item.price ? (
              <p className="mt-4 text-2xl font-semibold text-emerald-700">
                {String(item.price)}
              </p>
            ) : null}

            {item.location ? (
              <p className="mt-3 text-base text-neutral-600">{item.location}</p>
            ) : null}

            {item.description ? (
              <div className="mt-6">
                <h2 className="text-lg font-semibold text-neutral-900 mb-2">Description</h2>
                <p className="text-base leading-7 text-neutral-700 whitespace-pre-wrap">
                  {item.description}
                </p>
              </div>
            ) : null}

            {(item.seller_name || item.created_at) ? (
              <div className="mt-8 pt-6 border-t border-neutral-200 text-sm text-neutral-500">
                {item.seller_name ? <p>Posted by: {item.seller_name}</p> : null}
                {item.created_at ? (
                  <p className="mt-1">
                    Posted: {new Date(item.created_at).toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}