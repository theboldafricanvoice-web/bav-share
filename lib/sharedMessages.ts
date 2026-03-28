import { supabase } from "./supabase";

export type SharedMessage = {
  token: string;
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

export async function getSharedMessageByToken(
  token: string
): Promise<SharedMessage | null> {
  const { data, error } = await supabase
    .from("shared_messages")
    .select(
      "token, title, preview_text, thumbnail_url, sender_name, preview_type, media_url, mime_type, file_name, created_at, expires_at, is_active"
    )
    .eq("token", token)
    .eq("is_active", true)
    .maybeSingle();

  console.log("shared_messages lookup token:", token);
  console.log("shared_messages data:", data);
  console.log("shared_messages error:", error);

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

  return data as SharedMessage;
}