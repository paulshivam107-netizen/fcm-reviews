import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { sanitizeReviewTagArray } from "@/lib/review-attributes";
import { trackAppEvent } from "@/lib/server/analytics";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRestRequest, supabaseRpcRequest } from "@/lib/server/supabase-admin";
import { AdminManualReviewResponse } from "@/types/admin";

const MAX_PLAYER_NAME_LENGTH = 72;
const MAX_EVENT_NAME_LENGTH = 48;
const MAX_NOTE_LENGTH = 220;
const MIN_OVR = 1;
const MAX_OVR = 130;
const FALLBACK_PROGRAM_PROMO = "Community";
const MAX_PROS = 3;
const MAX_CONS = 2;

const COMMON_POSITIONS = new Set([
  "ST",
  "CF",
  "LW",
  "RW",
  "LF",
  "RF",
  "CAM",
  "CM",
  "CDM",
  "LM",
  "RM",
  "CB",
  "LB",
  "RB",
  "LWB",
  "RWB",
  "GK",
]);

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookupKey(value: string | null | undefined) {
  return normalizeFreeText(value).toLowerCase();
}

function normalizePosition(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length < 2 || cleaned.length > 4) return null;
  if (!COMMON_POSITIONS.has(cleaned)) return null;
  return cleaned;
}

function normalizeRank(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["1", "base", "white"].includes(raw)) return "Base";
  if (["2", "blue"].includes(raw)) return "Blue";
  if (["3", "purple"].includes(raw)) return "Purple";
  if (["4", "red"].includes(raw)) return "Red";
  if (["5", "gold"].includes(raw)) return "Gold";
  return null;
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      playerName?: string;
      playerOvr?: number;
      eventName?: string | null;
      sentimentScore?: number;
      playedPosition?: string;
      mentionedRankText?: string | null;
      pros?: string[];
      cons?: string[];
      note?: string | null;
    };

    const playerName = normalizeFreeText(payload.playerName).slice(
      0,
      MAX_PLAYER_NAME_LENGTH
    );
    if (playerName.length < 2) {
      return NextResponse.json(
        { error: "playerName must be at least 2 characters" },
        { status: 400 }
      );
    }

    const playerOvr = Number(payload.playerOvr);
    if (
      !Number.isInteger(playerOvr) ||
      playerOvr < MIN_OVR ||
      playerOvr > MAX_OVR
    ) {
      return NextResponse.json(
        { error: `playerOvr must be an integer between ${MIN_OVR} and ${MAX_OVR}` },
        { status: 400 }
      );
    }

    const eventName =
      normalizeFreeText(payload.eventName).slice(0, MAX_EVENT_NAME_LENGTH) || null;
    const sentimentScore = Number(payload.sentimentScore);
    if (
      !Number.isFinite(sentimentScore) ||
      sentimentScore < 1 ||
      sentimentScore > 10
    ) {
      return NextResponse.json(
        { error: "sentimentScore must be between 1 and 10" },
        { status: 400 }
      );
    }

    const playedPosition = normalizePosition(payload.playedPosition);
    if (!playedPosition) {
      return NextResponse.json(
        { error: "Invalid playedPosition" },
        { status: 400 }
      );
    }

    const mentionedRankText = normalizeRank(payload.mentionedRankText);
    const pros = sanitizeReviewTagArray({
      tags: payload.pros,
      position: playedPosition,
      max: MAX_PROS,
    });
    const cons = sanitizeReviewTagArray({
      tags: payload.cons,
      position: playedPosition,
      max: MAX_CONS,
    });
    const note = normalizeFreeText(payload.note).slice(0, MAX_NOTE_LENGTH) || null;
    const playerNameLookupKey = normalizeLookupKey(playerName);
    const eventNameLookupKey = eventName ? normalizeLookupKey(eventName) : null;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const response: AdminManualReviewResponse = {
        success: true,
        submissionId: `local-${Date.now()}`,
        playerId: `local-${playerNameLookupKey}-${playerOvr}`,
        refreshed: false,
        message: "Admin review added (local mock mode).",
      };
      return NextResponse.json(response, { status: 201 });
    }

    const playerLookupResponse = await supabaseRestRequest({
      endpoint: "players",
      method: "GET",
      query: {
        select: "id,player_name,base_ovr,program_promo",
        player_name: `ilike.${playerName}`,
        base_ovr: `eq.${playerOvr}`,
        is_active: "eq.true",
        order: "created_at.desc",
        limit: "30",
      },
      cache: "no-store",
    });

    if (!playerLookupResponse.ok) {
      const details = await playerLookupResponse.text();
      return NextResponse.json(
        { error: "Player lookup failed", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const candidatePlayers = (await playerLookupResponse.json()) as Array<{
      id: string;
      player_name: string;
      base_ovr: number;
      program_promo: string;
    }>;

    const exactNameMatches = candidatePlayers.filter(
      (row) =>
        normalizeLookupKey(row.player_name) === playerNameLookupKey &&
        row.base_ovr === playerOvr
    );

    let resolvedPlayerId =
      (eventNameLookupKey
        ? exactNameMatches.find(
            (row) => normalizeLookupKey(row.program_promo) === eventNameLookupKey
          )
        : exactNameMatches[0])?.id ?? null;

    if (!resolvedPlayerId) {
      const createPlayerResponse = await supabaseRestRequest({
        endpoint: "players",
        method: "POST",
        prefer: "return=representation",
        body: [
          {
            player_name: playerName,
            base_ovr: playerOvr,
            base_position: playedPosition,
            program_promo: eventName ?? FALLBACK_PROGRAM_PROMO,
            is_active: true,
          },
        ],
        cache: "no-store",
      });

      if (!createPlayerResponse.ok) {
        const details = await createPlayerResponse.text();
        return NextResponse.json(
          { error: "Failed to create player", details: details.slice(0, 500) },
          { status: 500 }
        );
      }

      const createdRows = (await createPlayerResponse.json()) as Array<{ id: string }>;
      resolvedPlayerId = createdRows[0]?.id ?? null;
    }

    if (!resolvedPlayerId) {
      return NextResponse.json(
        { error: "Unable to resolve player for review." },
        { status: 500 }
      );
    }

    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || null;
    const userAgent = request.headers.get("user-agent") ?? "unknown";

    const insertResponse = await supabaseRestRequest({
      endpoint: "user_review_submissions",
      method: "POST",
      prefer: "return=representation",
      body: [
        {
          player_id: resolvedPlayerId,
          source_platform: "user",
          submission_fingerprint: `admin:${auth.session.email}`,
          submitted_from_ip: ip,
          user_agent: userAgent.slice(0, 350),
          sentiment_score: Number(sentimentScore.toFixed(2)),
          played_position: playedPosition,
          mentioned_rank_text: mentionedRankText,
          pros,
          cons,
          note,
          status: "approved",
        },
      ],
      cache: "no-store",
    });

    if (!insertResponse.ok) {
      const details = await insertResponse.text();
      return NextResponse.json(
        { error: "Failed to insert admin review", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const insertedRows = (await insertResponse.json()) as Array<{ id: string }>;
    const submissionId = insertedRows[0]?.id ?? "";

    const refreshResponse = await supabaseRpcRequest({
      endpoint: "refresh_player_sentiment_summary",
      body: {},
    });

    await trackAppEvent({
      eventType: "review_submitted",
      playerId: resolvedPlayerId,
      metadata: { source: "admin-manual", status: "approved", refreshed: refreshResponse.ok },
      request,
    });

    const response: AdminManualReviewResponse = {
      success: true,
      submissionId,
      playerId: resolvedPlayerId,
      refreshed: refreshResponse.ok,
      message: "Admin review added and published.",
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid admin review payload",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
