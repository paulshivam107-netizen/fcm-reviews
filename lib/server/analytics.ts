import { NextRequest } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { supabaseRestRequest } from "@/lib/server/supabase-admin";

export type AppEventType =
  | "search_submitted"
  | "card_opened"
  | "review_submitted"
  | "review_moderated";

type TrackEventInput = {
  eventType: AppEventType;
  playerId?: string | null;
  queryText?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest | null;
};

function getClientFingerprint(request: NextRequest | null | undefined) {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.REVIEW_FINGERPRINT_SALT ?? "fcm-reviews";

  // Keep this lightweight and privacy-safe by storing a short derived key.
  const base = `${ip}|${userAgent}|${salt}`;
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) {
    hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export async function trackAppEvent(input: TrackEventInput) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) return;

    await supabaseRestRequest({
      endpoint: "app_event_logs",
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          event_type: input.eventType,
          player_id: input.playerId ?? null,
          query_text: input.queryText ?? null,
          client_fingerprint: getClientFingerprint(input.request),
          metadata: input.metadata ?? null,
        },
      ],
    });
  } catch {
    // Analytics must never block the main request path.
  }
}

