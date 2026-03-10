import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  listRedditImportQueue,
  queueRedditImport,
  reviewQueuedRedditImport,
} from "@/src/admin/reddit/service";
import {
  AdminRedditImportQueueMutationResponse,
  AdminRedditImportQueueResponse,
} from "@/types/admin-imports";

function normalizeStatus(value: string | null) {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const status = normalizeStatus(request.nextUrl.searchParams.get("status"));
    const items = await listRedditImportQueue(status);
    const response: AdminRedditImportQueueResponse = {
      items,
      meta: {
        count: items.length,
        status,
      },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch Reddit import queue",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      playerId?: string | null;
      sourceMode: "url" | "text";
      sourceUrl?: string | null;
      sourceSubreddit?: string | null;
      sourceAuthor?: string | null;
      sourcePublishedAt?: string | null;
      sourceExternalId?: string;
      sourcePostId?: string | null;
      title?: string | null;
      body?: string;
      playerName?: string;
      playerOvr?: number;
      eventName?: string | null;
      playedPosition?: string;
      mentionedRankText?: string | null;
      sentimentScore?: number;
      pros?: string[];
      cons?: string[];
      summary?: string | null;
      rawPayload?: Record<string, unknown>;
      confidence?: number;
      needsReview?: boolean;
    };

    if (!payload.sourceExternalId || !payload.body || !payload.playerName || !payload.playedPosition) {
      return NextResponse.json({ error: "Missing required queue fields" }, { status: 400 });
    }

    const item = await queueRedditImport({
      playerId: payload.playerId ?? null,
      sourceMode: payload.sourceMode,
      sourceUrl: payload.sourceUrl ?? null,
      sourceSubreddit: payload.sourceSubreddit ?? null,
      sourceAuthor: payload.sourceAuthor ?? null,
      sourcePublishedAt: payload.sourcePublishedAt ?? null,
      sourceExternalId: payload.sourceExternalId,
      sourcePostId: payload.sourcePostId ?? null,
      title: payload.title ?? null,
      body: payload.body,
      playerName: payload.playerName,
      playerOvr: Number(payload.playerOvr),
      eventName: payload.eventName ?? null,
      playedPosition: payload.playedPosition,
      mentionedRankText: payload.mentionedRankText ?? null,
      sentimentScore: Number(payload.sentimentScore),
      pros: Array.isArray(payload.pros) ? payload.pros : [],
      cons: Array.isArray(payload.cons) ? payload.cons : [],
      summary: payload.summary ?? null,
      rawPayload: payload.rawPayload,
      confidence: payload.confidence,
      needsReview: payload.needsReview,
    });

    const response: AdminRedditImportQueueMutationResponse = {
      success: true,
      item,
      message: "Reddit import added to moderation queue.",
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to queue Reddit import",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      id?: string;
      action?: "approve" | "reject";
      reviewNote?: string | null;
    };

    const id = String(payload.id ?? "").trim();
    if (!id || (payload.action !== "approve" && payload.action !== "reject")) {
      return NextResponse.json({ error: "Invalid review action." }, { status: 400 });
    }

    const result = await reviewQueuedRedditImport({
      id,
      action: payload.action,
      reviewNote: payload.reviewNote ?? null,
    });

    const response: AdminRedditImportQueueMutationResponse = {
      success: true,
      item: result.item,
      message: result.message,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to review queued import",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
