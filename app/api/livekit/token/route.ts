import { createClient } from "@supabase/supabase-js";
import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req: NextRequest) {
  try {
    if (
      !LIVEKIT_API_KEY ||
      !LIVEKIT_API_SECRET ||
      !LIVEKIT_URL ||
      !SUPABASE_URL ||
      !SUPABASE_ANON_KEY
    ) {
      return NextResponse.json(
        { error: "Server environment is incomplete." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing authorization token." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const callSessionId = body?.callSessionId;

    if (!callSessionId) {
      return NextResponse.json(
        { error: "Missing callSessionId." },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized user." },
        { status: 401 }
      );
    }

    const { data: sessionRow, error: sessionError } = await supabase
      .from("call_sessions")
      .select("id, room_name")
      .eq("id", callSessionId)
      .single();

    if (sessionError || !sessionRow?.room_name) {
      return NextResponse.json(
        { error: "Call session not found." },
        { status: 404 }
      );
    }

    const { data: participantRow, error: participantError } = await supabase
      .from("call_participants")
      .select("id")
      .eq("call_session_id", callSessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (participantError || !participantRow) {
      return NextResponse.json(
        { error: "You are not a participant in this call." },
        { status: 403 }
      );
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: user.id,
      ttl: "1h",
    });

    token.addGrant({
      roomJoin: true,
      room: sessionRow.room_name,
      canPublish: true,
      canSubscribe: true,
    });

    const participantToken = await token.toJwt();

    return NextResponse.json({
      serverUrl: LIVEKIT_URL,
      participantToken,
      roomName: sessionRow.room_name,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to create LiveKit token.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}