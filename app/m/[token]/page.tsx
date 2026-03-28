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

function getOgImage(sharedMessage: Awaited<ReturnType<typeof getSharedMessageByToken>>) {
  if (!sharedMessage) return defaultOgImage;

  if (sharedMessage.preview_type === "image" && sharedMessage.thumbnail_url?.trim()) {
    return sharedMessage.thumbnail_url.trim();
  }

  if (sharedMessage.thumbnail_url?.trim()) {
    return sharedMessage.thumbnail_url.trim();
  }

  return defaultOgImage;
}

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
  const image = getOgImage(sharedMessage);
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

function MediaHeader({
  sharedMessage,
}: {
  sharedMessage: NonNullable<Awaited<ReturnType<typeof getSharedMessageByToken>>>;
}) {
  if (
    sharedMessage.preview_type === "image" &&
    sharedMessage.thumbnail_url?.trim()
  ) {
    return (
      <img
        src={sharedMessage.thumbnail_url}
        alt={sharedMessage.title || "Shared image"}
        className="h-64 w-full object-cover"
      />
    );
  }

  if (
    sharedMessage.preview_type === "video" &&
    sharedMessage.media_url?.trim()
  ) {
    return (
      <div className="bg-black">
        <video
          src={sharedMessage.media_url}
          controls
          preload="metadata"
          playsInline
          className="h-64 w-full bg-black"
        >
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  if (
    sharedMessage.preview_type === "audio" &&
    sharedMessage.media_url?.trim()
  ) {
    return (
      <div className="flex min-h-48 w-full items-center justify-center bg-neutral-900 px-6 py-8 text-white">
        <div className="w-full max-w-lg text-center">
          <p className="text-sm uppercase tracking-[0.2em] opacity-70">
            BAV Network
          </p>
          <h1 className="mt-2 text-2xl font-bold">Shared Audio</h1>
          <p className="mt-2 text-sm opacity-80">
            {sharedMessage.file_name || "Audio file"}
          </p>
          <audio
            src={sharedMessage.media_url}
            controls
            preload="metadata"
            className="mt-5 w-full"
          >
            Your browser does not support audio playback.
          </audio>
        </div>
      </div>
    );
  }

  if (
    sharedMessage.preview_type === "file" &&
    sharedMessage.media_url?.trim()
  ) {
    return (
      <div className="flex min-h-48 w-full items-center justify-center bg-neutral-900 px-6 py-8 text-white">
        <div className="w-full max-w-lg text-center">
          <p className="text-sm uppercase tracking-[0.2em] opacity-70">
            BAV Network
          </p>
          <h1 className="mt-2 text-2xl font-bold">Shared File</h1>
          <p className="mt-2 text-sm opacity-80">
            {sharedMessage.file_name || "Document"}
          </p>
          <a
            href={sharedMessage.media_url}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200"
          >
            Open file
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-48 w-full items-center justify-center bg-neutral-900 text-white">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.2em] opacity-70">
          BAV Network
        </p>
        <h1 className="mt-2 text-2xl font-bold">Shared Message</h1>
      </div>
    </div>
  );
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
        <MediaHeader sharedMessage={sharedMessage} />

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

          {sharedMessage.preview_type === "file" &&
          sharedMessage.media_url?.trim() ? (
            <div className="mt-4">
              <a
                href={sharedMessage.media_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-neutral-700 underline underline-offset-4"
              >
                Open {sharedMessage.file_name || "attachment"}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}