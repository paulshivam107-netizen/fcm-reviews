import { NextRequest, NextResponse } from "next/server";
import { LOCAL_MOCK_PLAYERS, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { requireAdminSession } from "@/lib/server/admin-session";
import { supabaseRestRequest, supabaseRpcRequest } from "@/lib/server/supabase-admin";
import {
  AdminArchiveStaleResponse,
  AdminPlayerItem,
  AdminPlayerMutationResponse,
  AdminPlayersListResponse,
} from "@/types/admin";

const MAX_LIMIT = 120;
const MIN_LIMIT = 1;
const MIN_OVR = 1;
const MAX_OVR = 130;
const MAX_PLAYER_NAME_LENGTH = 72;
const MAX_PROGRAM_PROMO_LENGTH = 48;
const FALLBACK_PROGRAM_PROMO = "Community";
const MIN_STALE_DAYS = 1;
const MAX_STALE_DAYS = 365;
const DEFAULT_STALE_DAYS = 30;
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

type SupabasePlayerRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SupabasePlayerSummaryRow = {
  player_id: string;
  mention_count: number;
  avg_sentiment_score: number | null;
};

type LocalAdminPlayer = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  is_active: boolean;
  mention_count: number;
  avg_sentiment_score: number | null;
  created_at: string;
  updated_at: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __fcmLocalAdminPlayers: LocalAdminPlayer[] | undefined;
}

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? "40", 10);
  if (!Number.isFinite(raw)) return 40;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, raw));
}

function parseIncludeInactive(value: string | null) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function normalizeFreeText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeForIlike(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
}

function normalizeLookupKey(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getLocalStore() {
  if (globalThis.__fcmLocalAdminPlayers) {
    return globalThis.__fcmLocalAdminPlayers;
  }

  globalThis.__fcmLocalAdminPlayers = LOCAL_MOCK_PLAYERS.map((row) => ({
    id: row.player_id,
    player_name: row.player_name,
    base_ovr: row.base_ovr,
    base_position: row.base_position,
    program_promo: row.program_promo,
    is_active: true,
    mention_count: row.mention_count,
    avg_sentiment_score: row.avg_sentiment_score,
    created_at: row.last_processed_at ?? "2026-02-20T00:00:00.000Z",
    updated_at: row.last_processed_at ?? "2026-02-20T00:00:00.000Z",
  }));

  return globalThis.__fcmLocalAdminPlayers;
}

function toAdminPlayerItem(
  row: SupabasePlayerRow | LocalAdminPlayer,
  summary?: SupabasePlayerSummaryRow
): AdminPlayerItem {
  const mentionCountFromRow = "mention_count" in row ? row.mention_count : 0;
  const avgSentimentFromRow =
    "avg_sentiment_score" in row ? row.avg_sentiment_score : null;
  return {
    playerId: row.id,
    playerName: row.player_name,
    baseOvr: row.base_ovr,
    basePosition: row.base_position,
    programPromo: row.program_promo,
    isActive: row.is_active,
    mentionCount: summary?.mention_count ?? mentionCountFromRow ?? 0,
    avgSentimentScore: summary?.avg_sentiment_score ?? avgSentimentFromRow ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildListResponse(args: {
  items: AdminPlayerItem[];
  query: string;
  includeInactive: boolean;
}) {
  const payload: AdminPlayersListResponse = {
    items: args.items,
    meta: {
      count: args.items.length,
      query: args.query,
      includeInactive: args.includeInactive,
    },
  };

  return NextResponse.json(payload);
}

async function loadSummaryMap(playerIds: string[]) {
  const out = new Map<string, SupabasePlayerSummaryRow>();
  if (!playerIds.length) return out;

  const response = await supabaseRestRequest({
    endpoint: "mv_player_sentiment_summary",
    method: "GET",
    query: {
      select: "player_id,mention_count,avg_sentiment_score",
      player_id: `in.(${playerIds.join(",")})`,
    },
    cache: "no-store",
  });

  if (!response.ok) return out;
  const rows = (await response.json()) as SupabasePlayerSummaryRow[];
  for (const row of rows) {
    out.set(row.player_id, row);
  }
  return out;
}

async function adoptReviewedSiblingIfNeeded(args: {
  updated: SupabasePlayerRow;
  targetMentionCount: number;
  identityChanged: boolean;
}): Promise<{ mergedFromPlayerId: string | null; refreshed: boolean }> {
  const { updated, targetMentionCount, identityChanged } = args;
  if (!identityChanged || targetMentionCount > 0) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const cleanedName = sanitizeForIlike(updated.player_name);
  if (!cleanedName) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const siblingResponse = await supabaseRestRequest({
    endpoint: "players",
    method: "GET",
    query: {
      select: [
        "id",
        "player_name",
        "base_ovr",
        "base_position",
        "program_promo",
        "is_active",
        "created_at",
        "updated_at",
      ].join(","),
      id: `neq.${updated.id}`,
      base_position: `eq.${updated.base_position}`,
      player_name: `ilike.*${cleanedName}*`,
      limit: "20",
    },
    cache: "no-store",
  });

  if (!siblingResponse.ok) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const siblingRows = (await siblingResponse.json()) as SupabasePlayerRow[];
  const exactSiblings = siblingRows.filter(
    (row) =>
      normalizeLookupKey(row.player_name) === normalizeLookupKey(updated.player_name)
  );
  if (exactSiblings.length === 0) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const reviewedSiblings: SupabasePlayerRow[] = [];
  for (const sibling of exactSiblings) {
    const [redditMentionResponse, approvedUserReviewResponse] = await Promise.all([
      supabaseRestRequest({
        endpoint: "player_sentiment_mentions",
        method: "GET",
        query: {
          select: "id",
          player_id: `eq.${sibling.id}`,
          limit: "1",
        },
        cache: "no-store",
      }),
      supabaseRestRequest({
        endpoint: "user_review_submissions",
        method: "GET",
        query: {
          select: "id",
          player_id: `eq.${sibling.id}`,
          status: "eq.approved",
          limit: "1",
        },
        cache: "no-store",
      }),
    ]);

    const redditMentionRows = redditMentionResponse.ok
      ? ((await redditMentionResponse.json()) as Array<{ id: string }>)
      : [];
    const approvedUserReviewRows = approvedUserReviewResponse.ok
      ? ((await approvedUserReviewResponse.json()) as Array<{ id: string }>)
      : [];

    if (redditMentionRows.length > 0 || approvedUserReviewRows.length > 0) {
      reviewedSiblings.push(sibling);
    }
  }

  // Keep this deterministic and safe: auto-adopt only when there is exactly one
  // reviewed sibling candidate.
  if (reviewedSiblings.length !== 1) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const source = reviewedSiblings[0];

  const moveMentionsResponse = await supabaseRestRequest({
    endpoint: "player_sentiment_mentions",
    method: "PATCH",
    query: {
      player_id: `eq.${source.id}`,
    },
    body: {
      player_id: updated.id,
    },
    cache: "no-store",
  });
  if (!moveMentionsResponse.ok) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const moveUserReviewsResponse = await supabaseRestRequest({
    endpoint: "user_review_submissions",
    method: "PATCH",
    query: {
      player_id: `eq.${source.id}`,
    },
    body: {
      player_id: updated.id,
    },
    cache: "no-store",
  });
  if (!moveUserReviewsResponse.ok) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const archiveSourceResponse = await supabaseRestRequest({
    endpoint: "players",
    method: "PATCH",
    query: {
      id: `eq.${source.id}`,
    },
    body: {
      is_active: false,
    },
    cache: "no-store",
  });
  if (!archiveSourceResponse.ok) {
    return { mergedFromPlayerId: null, refreshed: false };
  }

  const refreshResponse = await supabaseRpcRequest({
    endpoint: "refresh_player_sentiment_summary",
    body: {},
  });

  return {
    mergedFromPlayerId: source.id,
    refreshed: refreshResponse.ok,
  };
}

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  const queryText = normalizeFreeText(request.nextUrl.searchParams.get("q"));
  const includeInactive = parseIncludeInactive(
    request.nextUrl.searchParams.get("includeInactive")
  );
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockData) {
    const store = getLocalStore();
    const isNumericQuery =
      /^\d{1,3}$/.test(queryText) &&
      Number(queryText) >= MIN_OVR &&
      Number(queryText) <= MAX_OVR;
    const lowered = queryText.toLowerCase();

    const rows = store
      .filter((row) => includeInactive || row.is_active)
      .filter((row) => {
        if (!queryText) return true;
        if (isNumericQuery) {
          return row.base_ovr === Number(queryText);
        }
        return (
          row.player_name.toLowerCase().includes(lowered) ||
          row.program_promo.toLowerCase().includes(lowered) ||
          row.base_position.toLowerCase().includes(lowered)
        );
      })
      .sort((a, b) => {
        if (a.updated_at !== b.updated_at) {
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }
        return b.base_ovr - a.base_ovr;
      })
      .slice(0, limit)
      .map((row) => toAdminPlayerItem(row));

    return buildListResponse({
      items: rows,
      query: queryText,
      includeInactive,
    });
  }

  try {
    const query: Record<string, string> = {
      select: [
        "id",
        "player_name",
        "base_ovr",
        "base_position",
        "program_promo",
        "is_active",
        "created_at",
        "updated_at",
      ].join(","),
      order: "updated_at.desc,base_ovr.desc,player_name.asc",
      limit: String(limit),
    };

    if (!includeInactive) {
      query.is_active = "eq.true";
    }

    if (/^\d{1,3}$/.test(queryText)) {
      const ovr = Number(queryText);
      if (ovr >= MIN_OVR && ovr <= MAX_OVR) {
        query.base_ovr = `eq.${ovr}`;
      }
    } else if (queryText) {
      const cleaned = sanitizeForIlike(queryText);
      if (cleaned) {
        query.or = `(player_name.ilike.*${cleaned}*,program_promo.ilike.*${cleaned}*,base_position.ilike.*${cleaned}*)`;
      }
    }

    const response = await supabaseRestRequest({
      endpoint: "players",
      method: "GET",
      query,
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json(
        { error: "Failed to fetch players", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const players = (await response.json()) as SupabasePlayerRow[];
    const playerIds = players.map((row) => row.id);
    const summaryMap = await loadSummaryMap(playerIds);
    const items = players.map((row) => toAdminPlayerItem(row, summaryMap.get(row.id)));

    return buildListResponse({
      items,
      query: queryText,
      includeInactive,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load players",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as {
      playerId?: string;
      playerName?: string;
      baseOvr?: number;
      basePosition?: string;
      programPromo?: string | null;
      isActive?: boolean;
    };

    const playerId = String(payload.playerId ?? "").trim();
    if (!isUuidLike(playerId)) {
      return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
    }

    const updates: Record<string, string | number | boolean> = {};
    let identityChanged = false;

    if (payload.playerName !== undefined) {
      const playerName = normalizeFreeText(payload.playerName);
      if (playerName.length < 2 || playerName.length > MAX_PLAYER_NAME_LENGTH) {
        return NextResponse.json(
          {
            error: `playerName must be between 2 and ${MAX_PLAYER_NAME_LENGTH} characters`,
          },
          { status: 400 }
        );
      }
      updates.player_name = playerName;
      identityChanged = true;
    }

    if (payload.baseOvr !== undefined) {
      const baseOvr = Number(payload.baseOvr);
      if (!Number.isInteger(baseOvr) || baseOvr < MIN_OVR || baseOvr > MAX_OVR) {
        return NextResponse.json(
          { error: `baseOvr must be an integer between ${MIN_OVR} and ${MAX_OVR}` },
          { status: 400 }
        );
      }
      updates.base_ovr = baseOvr;
      identityChanged = true;
    }

    if (payload.basePosition !== undefined) {
      const basePosition = normalizePosition(payload.basePosition);
      if (!basePosition) {
        return NextResponse.json({ error: "Invalid basePosition" }, { status: 400 });
      }
      updates.base_position = basePosition;
      identityChanged = true;
    }

    if (payload.programPromo !== undefined) {
      const programPromo = normalizeFreeText(payload.programPromo);
      if (programPromo.length > MAX_PROGRAM_PROMO_LENGTH) {
        return NextResponse.json(
          {
            error: `programPromo must be at most ${MAX_PROGRAM_PROMO_LENGTH} characters`,
          },
          { status: 400 }
        );
      }
      updates.program_promo = programPromo || FALLBACK_PROGRAM_PROMO;
      identityChanged = true;
    }

    if (payload.isActive !== undefined) {
      updates.is_active = Boolean(payload.isActive);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const store = getLocalStore();
      const target = store.find((row) => row.id === playerId);
      if (!target) {
        return NextResponse.json({ error: "Player not found" }, { status: 404 });
      }

      if (updates.player_name !== undefined) {
        target.player_name = String(updates.player_name);
      }
      if (updates.base_ovr !== undefined) {
        target.base_ovr = Number(updates.base_ovr);
      }
      if (updates.base_position !== undefined) {
        target.base_position = String(updates.base_position);
      }
      if (updates.program_promo !== undefined) {
        target.program_promo = String(updates.program_promo);
      }
      if (updates.is_active !== undefined) {
        target.is_active = Boolean(updates.is_active);
      }
      target.updated_at = new Date().toISOString();

      const response: AdminPlayerMutationResponse = {
        success: true,
        item: toAdminPlayerItem(target),
        refreshed: false,
      };
      return NextResponse.json(response);
    }

    const updateResponse = await supabaseRestRequest({
      endpoint: "players",
      method: "PATCH",
      prefer: "return=representation",
      query: {
        id: `eq.${playerId}`,
        select: [
          "id",
          "player_name",
          "base_ovr",
          "base_position",
          "program_promo",
          "is_active",
          "created_at",
          "updated_at",
        ].join(","),
      },
      body: updates,
      cache: "no-store",
    });

    if (!updateResponse.ok) {
      const details = await updateResponse.text();
      if (details.toLowerCase().includes("duplicate key value")) {
        return NextResponse.json(
          { error: "A player with the same identity already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to update player", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const updatedRows = (await updateResponse.json()) as SupabasePlayerRow[];
    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const refreshResponse = await supabaseRpcRequest({
      endpoint: "refresh_player_sentiment_summary",
      body: {},
    });
    const refreshed = refreshResponse.ok;

    const summaryMap = await loadSummaryMap([updated.id]);
    const initialMentionCount = summaryMap.get(updated.id)?.mention_count ?? 0;
    const adoptResult = await adoptReviewedSiblingIfNeeded({
      updated,
      targetMentionCount: initialMentionCount,
      identityChanged,
    });
    const finalSummaryMap =
      adoptResult.mergedFromPlayerId !== null
        ? await loadSummaryMap([updated.id])
        : summaryMap;
    const response: AdminPlayerMutationResponse = {
      success: true,
      item: toAdminPlayerItem(updated, finalSummaryMap.get(updated.id)),
      refreshed: refreshed || adoptResult.refreshed,
      mergedFromPlayerId: adoptResult.mergedFromPlayerId,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid player update request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as { days?: number };
    const rawDays = Number(payload.days ?? DEFAULT_STALE_DAYS);
    const days = Number.isInteger(rawDays)
      ? Math.max(MIN_STALE_DAYS, Math.min(MAX_STALE_DAYS, rawDays))
      : DEFAULT_STALE_DAYS;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const store = getLocalStore();
      let archivedCount = 0;

      for (const row of store) {
        if (!row.is_active) continue;
        const reference = new Date(row.updated_at).getTime();
        if (Number.isFinite(reference) && reference < cutoff) {
          row.is_active = false;
          row.updated_at = new Date().toISOString();
          archivedCount += 1;
        }
      }

      const response: AdminArchiveStaleResponse = {
        success: true,
        archivedCount,
        days,
        refreshed: false,
      };
      return NextResponse.json(response);
    }

    const archiveResponse = await supabaseRpcRequest({
      endpoint: "archive_stale_players",
      body: {
        days_without_update: days,
      },
    });

    if (!archiveResponse.ok) {
      const details = await archiveResponse.text();
      return NextResponse.json(
        { error: "Failed to archive stale players", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const archivedCount = Number(await archiveResponse.json());
    const refreshResponse = await supabaseRpcRequest({
      endpoint: "refresh_player_sentiment_summary",
      body: {},
    });

    const response: AdminArchiveStaleResponse = {
      success: true,
      archivedCount: Number.isFinite(archivedCount) ? archivedCount : 0,
      days,
      refreshed: refreshResponse.ok,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid archive request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json()) as { playerId?: string };
    const playerId = String(payload.playerId ?? "").trim();
    if (!isUuidLike(playerId)) {
      return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const useLocalMockData = shouldUseLocalMockData(supabaseUrl, supabaseKey);

    if (useLocalMockData) {
      const store = getLocalStore();
      const target = store.find((row) => row.id === playerId);
      if (!target) {
        return NextResponse.json({ error: "Player not found" }, { status: 404 });
      }

      target.is_active = false;
      target.updated_at = new Date().toISOString();

      const response: AdminPlayerMutationResponse = {
        success: true,
        item: toAdminPlayerItem(target),
        refreshed: false,
      };
      return NextResponse.json(response);
    }

    const updateResponse = await supabaseRestRequest({
      endpoint: "players",
      method: "PATCH",
      prefer: "return=representation",
      query: {
        id: `eq.${playerId}`,
        select: [
          "id",
          "player_name",
          "base_ovr",
          "base_position",
          "program_promo",
          "is_active",
          "created_at",
          "updated_at",
        ].join(","),
      },
      body: {
        is_active: false,
      },
      cache: "no-store",
    });

    if (!updateResponse.ok) {
      const details = await updateResponse.text();
      return NextResponse.json(
        { error: "Failed to delete player", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const updatedRows = (await updateResponse.json()) as SupabasePlayerRow[];
    const updated = updatedRows[0];
    if (!updated) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const refreshResponse = await supabaseRpcRequest({
      endpoint: "refresh_player_sentiment_summary",
      body: {},
    });
    const refreshed = refreshResponse.ok;

    const response: AdminPlayerMutationResponse = {
      success: true,
      item: toAdminPlayerItem(updated),
      refreshed,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid player delete request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
