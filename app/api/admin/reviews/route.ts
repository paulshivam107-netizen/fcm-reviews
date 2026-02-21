import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  LOCAL_MOCK_PLAYERS,
  LOCAL_MOCK_REVIEW_SEEDS,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { requireAdminToken } from "@/lib/server/admin-auth";
import { trackAppEvent } from "@/lib/server/analytics";
import { supabaseRestRequest, supabaseRpcRequest } from "@/lib/server/supabase-admin";
import {
  AdminReviewQueueItem,
  AdminReviewQueueResponse,
  ModerationStatus,
} from "@/types/review";

type ModerationAction = "approve" | "reject";

type SupabaseSubmissionRow = {
  id: string;
  player_id: string;
  sentiment_score: number | string;
  played_position: string;
  mentioned_rank_text: string | null;
  pros: string[] | null;
  cons: string[] | null;
  note: string | null;
  submitted_username: string | null;
  submitted_username_type: "reddit" | "game" | null;
  status: ModerationStatus;
  submitted_at: string;
};

type SupabasePlayerRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
};

type LocalQueueItem = AdminReviewQueueItem & {
  moderationReason: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __fcmLocalModerationQueue: LocalQueueItem[] | undefined;
}

const MAX_LIST_LIMIT = 80;

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseStatus(value: string | null): ModerationStatus {
  if (value === "approved" || value === "rejected") return value;
  return "pending";
}

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? "40", 10);
  if (!Number.isFinite(raw)) return 40;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, raw));
}

function parseModerationAction(value: unknown): ModerationAction | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "approve" || normalized === "reject") return normalized;
  return null;
}

function toScore(value: number | string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function getLocalQueueStore() {
  if (globalThis.__fcmLocalModerationQueue) {
    return globalThis.__fcmLocalModerationQueue;
  }

  const seeded: LocalQueueItem[] = LOCAL_MOCK_REVIEW_SEEDS.map((seed) => {
    const player = LOCAL_MOCK_PLAYERS.find((row) => row.player_id === seed.player_id);
    return {
      submissionId: seed.id || randomUUID(),
      playerId: seed.player_id,
      playerName: player?.player_name ?? seed.player_name,
      playerOvr: player?.base_ovr ?? 0,
      playerPosition: player?.base_position ?? seed.played_position,
      sentimentScore: seed.sentiment_score,
      playedPosition: seed.played_position,
      mentionedRankText: seed.mentioned_rank_text,
      pros: seed.pros,
      cons: seed.cons,
      note: seed.note,
      submittedUsername: seed.submitted_username,
      submittedUsernameType: seed.submitted_username_type,
      status: seed.status,
      submittedAt: seed.submitted_at,
      moderationReason: null,
    };
  });

  globalThis.__fcmLocalModerationQueue = seeded;
  return seeded;
}

function toQueueResponse(
  status: ModerationStatus,
  items: AdminReviewQueueItem[]
): NextResponse<AdminReviewQueueResponse> {
  return NextResponse.json({
    items,
    meta: {
      status,
      count: items.length,
    },
  });
}

export async function GET(request: NextRequest) {
  const auth = requireAdminToken(request);
  if (!auth.ok) return auth.response;

  const status = parseStatus(request.nextUrl.searchParams.get("status"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockData) {
    const rows = getLocalQueueStore()
      .filter((item) => item.status === status)
      .sort(
        (a, b) =>
          new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
      )
      .slice(0, limit);
    return toQueueResponse(status, rows);
  }

  try {
    const queueResponse = await supabaseRestRequest({
      endpoint: "user_review_submissions",
      method: "GET",
      query: {
        select: [
          "id",
          "player_id",
          "sentiment_score",
          "played_position",
          "mentioned_rank_text",
          "pros",
          "cons",
          "note",
          "submitted_username",
          "submitted_username_type",
          "status",
          "submitted_at",
        ].join(","),
        status: `eq.${status}`,
        order: "submitted_at.asc",
        limit: String(limit),
      },
      cache: "no-store",
    });

    if (!queueResponse.ok) {
      const details = await queueResponse.text();
      return NextResponse.json(
        { error: "Failed to fetch moderation queue", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const queueRows = (await queueResponse.json()) as SupabaseSubmissionRow[];
    const playerIds = [...new Set(queueRows.map((row) => row.player_id))];
    const playerMap = new Map<string, SupabasePlayerRow>();

    if (playerIds.length > 0) {
      const playersResponse = await supabaseRestRequest({
        endpoint: "players",
        method: "GET",
        query: {
          select: "id,player_name,base_ovr,base_position",
          id: `in.(${playerIds.join(",")})`,
        },
        cache: "no-store",
      });

      if (!playersResponse.ok) {
        const details = await playersResponse.text();
        return NextResponse.json(
          { error: "Failed to resolve players", details: details.slice(0, 500) },
          { status: 500 }
        );
      }

      const playerRows = (await playersResponse.json()) as SupabasePlayerRow[];
      for (const row of playerRows) {
        playerMap.set(row.id, row);
      }
    }

    const items: AdminReviewQueueItem[] = queueRows.map((row) => {
      const player = playerMap.get(row.player_id);
      return {
        submissionId: row.id,
        playerId: row.player_id,
        playerName: player?.player_name ?? "Unknown player",
        playerOvr: player?.base_ovr ?? 0,
        playerPosition: player?.base_position ?? row.played_position,
        sentimentScore: toScore(row.sentiment_score),
        playedPosition: row.played_position,
        mentionedRankText: row.mentioned_rank_text,
        pros: Array.isArray(row.pros) ? row.pros : [],
        cons: Array.isArray(row.cons) ? row.cons : [],
        note: row.note,
        submittedUsername: row.submitted_username,
        submittedUsernameType: row.submitted_username_type,
        status: row.status,
        submittedAt: row.submitted_at,
      };
    });

    return toQueueResponse(status, items);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load moderation queue",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminToken(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      submissionId?: string;
      action?: ModerationAction;
      moderationReason?: string | null;
    };

    const submissionId = String(payload.submissionId ?? "").trim();
    const action = parseModerationAction(payload.action);
    const moderationReason =
      String(payload.moderationReason ?? "").trim().slice(0, 300) || null;

    if (!isUuidLike(submissionId)) {
      return NextResponse.json({ error: "Invalid submissionId" }, { status: 400 });
    }

    if (!action) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const nextStatus: ModerationStatus =
      action === "approve" ? "approved" : "rejected";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const store = getLocalQueueStore();
      const target = store.find((item) => item.submissionId === submissionId);
      if (!target) {
        return NextResponse.json({ error: "Submission not found" }, { status: 404 });
      }

      target.status = nextStatus;
      target.moderationReason = moderationReason;

      await trackAppEvent({
        eventType: "review_moderated",
        playerId: target.playerId,
        metadata: { submissionId, action, source: "local-mock" },
        request,
      });

      return NextResponse.json({
        success: true,
        submissionId,
        status: nextStatus,
        refreshed: false,
      });
    }

    const updateResponse = await supabaseRestRequest({
      endpoint: "user_review_submissions",
      method: "PATCH",
      prefer: "return=representation",
      query: {
        id: `eq.${submissionId}`,
        select: "id,player_id,status",
      },
      body: {
        status: nextStatus,
        moderated_at: new Date().toISOString(),
        moderation_reason: moderationReason,
      },
      cache: "no-store",
    });

    if (!updateResponse.ok) {
      const details = await updateResponse.text();
      return NextResponse.json(
        { error: "Failed to update moderation status", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const updatedRows = (await updateResponse.json()) as Array<{
      id: string;
      player_id: string;
      status: ModerationStatus;
    }>;
    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    let refreshed = false;
    if (updated.status === "approved") {
      const refreshResponse = await supabaseRpcRequest({
        endpoint: "refresh_player_sentiment_summary",
        body: {},
      });
      refreshed = refreshResponse.ok;
    }

    await trackAppEvent({
      eventType: "review_moderated",
      playerId: updated.player_id,
      metadata: { submissionId, action, refreshed },
      request,
    });

    return NextResponse.json({
      success: true,
      submissionId: updated.id,
      status: updated.status,
      refreshed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid moderation request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

