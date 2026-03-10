import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import { trackAppEvent } from "@/lib/server/analytics";
import { publishRedditImport } from "@/src/admin/reddit/service";
import { AdminRedditImportPublishResponse } from "@/types/admin-imports";

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
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
    };

    if (!payload.sourceExternalId || !payload.body || !payload.playerName || !payload.playedPosition) {
      return NextResponse.json(
        { error: "Missing required import fields" },
        { status: 400 }
      );
    }

    const result = await publishRedditImport({
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
    });

    await trackAppEvent({
      eventType: "review_submitted",
      playerId: result.playerId,
      metadata: {
        source: "admin-reddit-import",
        refreshed: result.refreshed,
        sourceExternalId: result.sourceExternalId,
      },
      request,
    });

    const response: AdminRedditImportPublishResponse = {
      success: true,
      playerId: result.playerId,
      sourceExternalId: result.sourceExternalId,
      refreshed: result.refreshed,
      message: "Reddit review imported and published.",
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to publish Reddit import",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
