import { getSharedMessageByToken } from "@/lib/sharedMessages";
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

const WIDTH = 1200;
const HEIGHT = 630;

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://share.bavnetwork.com";

const defaultOgImage = `${siteUrl}/og-default.jpg`;

type SharedMessage = Awaited<ReturnType<typeof getSharedMessageByToken>>;

function getTitle(sharedMessage: NonNullable<SharedMessage>) {
  return sharedMessage.title?.trim() || "Shared from BAV Network";
}

function getDescription(sharedMessage: NonNullable<SharedMessage>) {
  return (
    sharedMessage.preview_text?.trim() ||
    "Open this shared message from BAV Network."
  );
}

function getPrimaryImageUrl(sharedMessage: SharedMessage) {
  if (!sharedMessage) return defaultOgImage;

  if (sharedMessage.thumbnail_url?.trim()) {
    return sharedMessage.thumbnail_url.trim();
  }

  if (
    sharedMessage.preview_type === "image" &&
    sharedMessage.media_url?.trim()
  ) {
    return sharedMessage.media_url.trim();
  }

  return defaultOgImage;
}

function truncate(text: string, max = 140) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

async function urlToDataUri(url: string) {
  try {
    const res = await fetch(url, {
      cache: "no-store",
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await res.arrayBuffer();

    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    const base64 = btoa(binary);
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

function getBadgeLabel(sharedMessage: NonNullable<SharedMessage>) {
  switch (sharedMessage.preview_type) {
    case "image":
      return "PHOTO";
    case "video":
      return "VIDEO";
    case "audio":
      return "AUDIO";
    case "file":
      return "FILE";
    default:
      return "SHARED";
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#111827",
            color: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 48,
            fontWeight: 800,
          }}
        >
          BAV Network
        </div>
      ),
      { width: WIDTH, height: HEIGHT }
    );
  }

  const sharedMessage = await getSharedMessageByToken(token);

  if (!sharedMessage) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#111827",
            color: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 42,
            fontWeight: 800,
          }}
        >
          Shared message not found
        </div>
      ),
      { width: WIDTH, height: HEIGHT }
    );
  }

  const title = getTitle(sharedMessage);
  const description = truncate(getDescription(sharedMessage), 150);
  const senderName = sharedMessage.sender_name?.trim() || "BAV Network";
  const badgeLabel = getBadgeLabel(sharedMessage);

  const primaryImageUrl = getPrimaryImageUrl(sharedMessage);
  const primaryImageDataUri = await urlToDataUri(primaryImageUrl);

  const showImage =
    !!primaryImageDataUri &&
    (sharedMessage.preview_type === "image" ||
      sharedMessage.preview_type === "video");

  return new ImageResponse(
    (
      <div
        style={{
          width: WIDTH,
          height: HEIGHT,
          display: "flex",
          flexDirection: "row",
          background: "#F3F4F6",
          color: "#111827",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: 700,
            height: HEIGHT,
            display: "flex",
            position: "relative",
            background: "#FFFFFF",
            borderRight: "1px solid #E5E7EB",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
         {showImage ? (
  <img
    src={primaryImageDataUri}
    alt={title}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "contain",
      background: "#FFFFFF",
    }}
  />
) : (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      background: "#111827",
      color: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 56,
      fontWeight: 800,
    }}
  >
    BAV
  </div>
)}

          <div
            style={{
              position: "absolute",
              top: 28,
              left: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 18px",
              borderRadius: 999,
              background: "#111827",
              color: "#FFFFFF",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: 1,
            }}
          >
            {badgeLabel}
          </div>

          {sharedMessage.preview_type === "video" ? (
            <div
              style={{
                position: "absolute",
                right: 28,
                bottom: 28,
                width: 88,
                height: 88,
                borderRadius: 999,
                background: "#F5C400",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderTop: "18px solid transparent",
                  borderBottom: "18px solid transparent",
                  borderLeft: "28px solid #111111",
                  marginLeft: 8,
                }}
              />
            </div>
          ) : null}
        </div>

        <div
          style={{
            width: 500,
            height: HEIGHT,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 42,
            background:
              "linear-gradient(180deg, #7F1D1D 0%, #111827 100%)",
            color: "#FFFFFF",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: 2,
                opacity: 0.9,
              }}
            >
              SHARED FROM BAV NETWORK
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 52,
                lineHeight: 1.1,
                fontWeight: 800,
              }}
            >
              {title}
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 18,
                fontSize: 28,
                color: "#E5E7EB",
              }}
            >
              Shared by {senderName}
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 28,
                padding: 24,
                borderRadius: 24,
                background: "rgba(255,255,255,0.10)",
                color: "#F9FAFB",
                fontSize: 28,
                lineHeight: 1.35,
              }}
            >
              {description}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderTop: "1px solid rgba(255,255,255,0.18)",
              paddingTop: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                color: "#F3F4F6",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 800 }}>share.bavnetwork.com</div>
              <div style={{ fontSize: 22, opacity: 0.75 }}>The Bold African Voice</div>
            </div>

            <div
              style={{
                display: "flex",
                padding: "10px 18px",
                borderRadius: 999,
                background: "#F5C400",
                color: "#111827",
                fontSize: 22,
                fontWeight: 800,
              }}
            >
              BAV
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
    }
  );
}