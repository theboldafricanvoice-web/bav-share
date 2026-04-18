import { getSharedMessageByToken } from "../../../lib/sharedMessages";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{
    token: string;
  }>;
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://share.bavnetwork.com";

const defaultOgImage = `${siteUrl}/og-default.jpg`;

function getOgImage(
  sharedMessage: Awaited<ReturnType<typeof getSharedMessageByToken>>
) {
  if (!sharedMessage) return defaultOgImage;

  if (sharedMessage.thumbnail_url?.trim()) {
    return sharedMessage.thumbnail_url.trim();
  }

  return defaultOgImage;
}

function getOgType(
  sharedMessage: Awaited<ReturnType<typeof getSharedMessageByToken>>
): "article" | "video.other" {
  if (sharedMessage?.preview_type === "video") {
    return "video.other";
  }

  return "article";
}

function getMediaUrl(
  sharedMessage: Awaited<ReturnType<typeof getSharedMessageByToken>>
) {
  return sharedMessage?.media_url?.trim() || null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const sharedMessage = await getSharedMessageByToken(token);

  if (!sharedMessage) {
    return {
      title: "Shared message not found",
      description: "This shared message is unavailable or has expired.",
    };
  }

  const title = sharedMessage.title?.trim() || "Shared from BAV Network";
  const description =
    sharedMessage.preview_text?.trim() ||
    "Open this shared message from BAV Network.";
  const image =
    sharedMessage.preview_type === "image" ||
    sharedMessage.preview_type === "video"
      ? `${siteUrl}/api/og/shared-message?token=${token}`
      : getOgImage(sharedMessage);
  const url = `${siteUrl}/m/${token}`;
  const ogType = getOgType(sharedMessage);

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
      type: ogType,
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
  const mediaUrl = getMediaUrl(sharedMessage);

  if (
    sharedMessage.preview_type === "image" &&
    sharedMessage.thumbnail_url?.trim()
  ) {
    return (
      <div className="w-full bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sharedMessage.thumbnail_url}
          alt={sharedMessage.title || "Shared image"}
          className="block h-auto w-full"
        />
      </div>
    );
  }

  if (sharedMessage.preview_type === "video") {
    if (sharedMessage.thumbnail_url?.trim()) {
      return (
        <div className="relative h-64 w-full bg-black">
          <Image
            src={sharedMessage.thumbnail_url}
            alt={sharedMessage.title || "Shared video"}
            fill
            className="object-contain"
            unoptimized
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/65 text-white shadow-lg">
              <svg
                viewBox="0 0 24 24"
                className="ml-1 h-8 w-8 fill-current"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
          {mediaUrl ? (
            <a
              href={mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="absolute bottom-4 right-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-lg transition hover:bg-neutral-200"
            >
              Watch video
            </a>
          ) : null}
        </div>
      );
    }

    if (mediaUrl) {
      return (
        <div className="bg-black">
          <video
            src={mediaUrl}
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

  const mediaUrl = getMediaUrl(sharedMessage);

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

          {sharedMessage.preview_type === "video" && mediaUrl ? (
            <div className="mt-6 space-y-4">
              <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-black">
                <video
                  src={mediaUrl}
                  controls
                  preload="metadata"
                  playsInline
                  poster={sharedMessage.thumbnail_url?.trim() || undefined}
                  className="w-full bg-black"
                >
                  Your browser does not support video playback.
                </video>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700"
                >
                  Watch video
                </a>
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={sharedMessage.file_name || undefined}
                  className="inline-flex rounded-full border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-100"
                >
                  Download video
                </a>
              </div>
            </div>
          ) : null}

          {sharedMessage.preview_type === "file" &&
          mediaUrl ? (
            <div className="mt-4">
              <a
                href={mediaUrl}
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
