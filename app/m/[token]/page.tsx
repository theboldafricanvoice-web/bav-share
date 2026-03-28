import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedMessageByToken } from "@/lib/sharedMessages";

type PageProps = {
  params: Promise<{
    token: string;
  }>;
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://share.bavnetwork.com";

const defaultOgImage = `${siteUrl}/og-default.jpg`;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const sharedMessage = await getSharedMessageByToken(token);

  if (!sharedMessage) {
    return {
      title: "Shared message not found | BAV Network",
      description: "This shared message is unavailable or has expired.",
    };
  }

  const title = sharedMessage.title?.trim() || "Shared from BAV Network";
  const description =
    sharedMessage.preview_text?.trim() ||
    "Open this shared message from BAV Network.";
  const image = sharedMessage.thumbnail_url?.trim() || defaultOgImage;
  const url = `${siteUrl}/m/${token}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      siteName: "BAV Network",
      type: "article",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function SharedMessagePage({ params }: PageProps) {
  const { token } = await params;
  const sharedMessage = await getSharedMessageByToken(token);

  if (!sharedMessage) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-lg">
        {sharedMessage.thumbnail_url ? (
          <img
            src={sharedMessage.thumbnail_url}
            alt={sharedMessage.title || "Shared preview"}
            className="h-64 w-full object-cover"
          />
        ) : (
          <div className="flex h-48 w-full items-center justify-center bg-neutral-900 text-white">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.2em] opacity-70">
                BAV Network
              </p>
              <h1 className="mt-2 text-2xl font-bold">Shared Message</h1>
            </div>
          </div>
        )}

        <div className="p-6 sm:p-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            Shared from BAV Network
          </p>

          <h1 className="text-2xl font-bold sm:text-3xl">
            {sharedMessage.title || "Shared Message"}
          </h1>

          {sharedMessage.sender_name ? (
            <p className="mt-3 text-sm text-neutral-500">
              Shared by {sharedMessage.sender_name}
            </p>
          ) : null}

          {sharedMessage.preview_text ? (
            <div className="mt-6 rounded-xl bg-neutral-50 p-4 text-base leading-7 text-neutral-700">
              {sharedMessage.preview_text}
            </div>
          ) : (
            <div className="mt-6 rounded-xl bg-neutral-50 p-4 text-base leading-7 text-neutral-500">
              No preview text available.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}