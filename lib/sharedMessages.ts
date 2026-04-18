import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type SharedMessage = {
  token: string;
  message_id: string;
  media_path: string | null;
  title: string | null;
  preview_text: string | null;
  thumbnail_url: string | null;
  sender_name: string | null;
  preview_type: "text" | "image" | "audio" | "video" | "file" | null;
  media_url: string | null;
  mime_type: string | null;
  file_name: string | null;
  created_at: string | null;
  expires_at: string | null;
  is_active: boolean;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

async function refreshMediaUrlFromMessage(
  sharedMessage: SharedMessage
): Promise<SharedMessage> {
  if (!supabaseAdmin) {
    return sharedMessage;
  }

  if (!sharedMessage.message_id || !["video", "audio", "file", "image"].includes(sharedMessage.preview_type ?? "")) {
    return sharedMessage;
  }

  let mediaPath = sharedMessage.media_path?.trim() || null;

  if (!mediaPath) {
    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from("chat_messages")
      .select("media_path")
      .eq("id", sharedMessage.message_id)
      .maybeSingle();

    if (messageError || !messageRow?.media_path) {
      return sharedMessage;
    }

    mediaPath = messageRow.media_path;
  }

  if (!mediaPath) {
    return sharedMessage;
  }

  const { data: signedData, error: signedError } = await supabaseAdmin.storage
    .from("chat-media")
    .createSignedUrl(mediaPath, 60 * 60 * 24 * 7);

  if (signedError || !signedData?.signedUrl) {
    return sharedMessage;
  }

  return {
    ...sharedMessage,
    media_path: mediaPath,
    media_url: signedData.signedUrl,
  };
}

export async function getSharedMessageByToken(
  token: string
): Promise<SharedMessage | null> {
  const { data, error } = await supabase
    .from("shared_messages")
    .select(
      "token, message_id, media_path, title, preview_text, thumbnail_url, sender_name, preview_type, media_url, mime_type, file_name, created_at, expires_at, is_active"
    )
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Error loading shared message:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }

  return await refreshMediaUrlFromMessage(data as SharedMessage);
}
