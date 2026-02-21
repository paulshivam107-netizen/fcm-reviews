import { NextRequest, NextResponse } from "next/server";
import { trackAppEvent, type AppEventType } from "@/lib/server/analytics";

const ALLOWED_EVENTS = new Set<AppEventType>([
  "search_submitted",
  "card_opened",
  "review_submitted",
  "review_moderated",
]);

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      eventType?: string;
      playerId?: string | null;
      queryText?: string | null;
      metadata?: Record<string, unknown> | null;
    };

    const eventType = String(payload.eventType ?? "").trim() as AppEventType;
    if (!ALLOWED_EVENTS.has(eventType)) {
      return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
    }

    const playerId = payload.playerId ? String(payload.playerId).trim() : null;
    if (playerId && !isUuidLike(playerId)) {
      return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
    }

    const queryText = payload.queryText
      ? String(payload.queryText).trim().slice(0, 140)
      : null;
    const metadata =
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : null;

    await trackAppEvent({
      eventType,
      playerId,
      queryText,
      metadata,
      request,
    });

    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid tracking payload",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

