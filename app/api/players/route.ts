import { NextRequest, NextResponse } from "next/server";
import { queryLocalMockPlayers, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { POSITION_GROUPS, parseTab } from "@/lib/position-groups";
import { parsePlayerSearch } from "@/lib/search";
import { PlayerRow, PlayerTab } from "@/types/player";

const MV_FIELDS = [
  "player_id",
  "player_name",
  "base_ovr",
  "base_position",
  "program_promo",
  "mention_count",
  "avg_sentiment_score",
  "top_pros",
  "top_cons",
  "last_processed_at",
].join(",");

const MAX_LIMIT = 60;
const SUPABASE_REQUEST_TIMEOUT_MS = 9000;

type PlayerIdentityRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
};

function sanitizeForIlike(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
}

function hasReviewSignal(row: PlayerRow) {
  const prosCount = Array.isArray(row.top_pros) ? row.top_pros.length : 0;
  const consCount = Array.isArray(row.top_cons) ? row.top_cons.length : 0;
  return (
    Number(row.mention_count ?? 0) > 0 ||
    row.avg_sentiment_score !== null ||
    prosCount > 0 ||
    consCount > 0 ||
    Boolean(row.last_processed_at)
  );
}

function buildPlayersResponse(args: {
  rows: PlayerRow[];
  tab: PlayerTab;
  parsed: ReturnType<typeof parsePlayerSearch>;
  cacheControl: string;
  dataSource: "supabase" | "local-mock" | "local-mock-fallback";
}) {
  const { rows, tab, parsed, cacheControl, dataSource } = args;

  return NextResponse.json(
    {
      items: rows,
      meta: {
        tab,
        query: parsed.raw,
        requestedOvr: parsed.requestedOvr,
        count: rows.length,
      },
    },
    {
      headers: {
        "Cache-Control": cacheControl,
        "X-Data-Source": dataSource,
      },
    }
  );
}

async function hydrateLatestPlayerIdentity(args: {
  rows: PlayerRow[];
  supabaseUrl: string;
  supabaseKey: string;
}): Promise<PlayerRow[]> {
  const { rows, supabaseUrl, supabaseKey } = args;
  if (!rows.length) return rows;

  const playerIds = Array.from(new Set(rows.map((row) => row.player_id)));
  const playersUrl = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/players`);
  playersUrl.searchParams.set(
    "select",
    "id,player_name,base_ovr,base_position,program_promo"
  );
  playersUrl.searchParams.set("id", `in.(${playerIds.join(",")})`);
  playersUrl.searchParams.set("is_active", "eq.true");

  const identityResponse = await fetch(playersUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    next: { revalidate: 300 },
  });

  if (!identityResponse.ok) {
    return rows;
  }

  const identityRows = (await identityResponse.json()) as PlayerIdentityRow[];
  const byId = new Map(identityRows.map((row) => [row.id, row]));

  return rows
    .map((row) => {
      const currentIdentity = byId.get(row.player_id);
      if (!currentIdentity) return null;
      return {
        ...row,
        player_name: currentIdentity.player_name,
        base_ovr: currentIdentity.base_ovr,
        base_position: currentIdentity.base_position,
        program_promo: currentIdentity.program_promo,
      };
    })
    .filter((row): row is PlayerRow => row !== null);
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  // Server route: prefer service role for stable read access/caching control.
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const tab = parseTab(request.nextUrl.searchParams.get("tab"));
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const parsed = parsePlayerSearch(q);
  const limitRaw = Number.parseInt(
    request.nextUrl.searchParams.get("limit") ?? "30",
    10
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : 30;
  const allowMockFallback =
    process.env.NODE_ENV !== "production" &&
    String(process.env.USE_LOCAL_MOCK_FALLBACK ?? "false").toLowerCase() === "true";
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const hasSearchQuery = parsed.raw.trim().length > 0;
  const getMockRows = () =>
    queryLocalMockPlayers({
      tab,
      parsed,
      limit,
      positionGroups: POSITION_GROUPS,
    });

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
    return buildPlayersResponse({
      rows: getMockRows(),
      tab,
      parsed,
      cacheControl: "no-store",
      dataSource: "local-mock",
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    if (allowMockFallback) {
      return buildPlayersResponse({
        rows: getMockRows(),
        tab,
        parsed,
        cacheControl: "no-store",
        dataSource: "local-mock-fallback",
      });
    }

    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
      },
      { status: 500 }
    );
  }

  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/mv_player_sentiment_summary`);
  url.searchParams.set("select", MV_FIELDS);
  if (!hasSearchQuery && !isOvrOnlyQuery) {
    url.searchParams.set(
      "base_position",
      `in.(${POSITION_GROUPS[tab].join(",")})`
    );
  }
  // Public list should surface only cards with at least one approved mention/review.
  url.searchParams.set("mention_count", "gt.0");
  url.searchParams.set("order", "avg_sentiment_score.desc.nullslast,mention_count.desc,base_ovr.desc");
  url.searchParams.set("limit", String(limit));

  if (parsed.requestedOvr !== null) {
    url.searchParams.set("base_ovr", `eq.${parsed.requestedOvr}`);
  }

  if (parsed.nameQuery) {
    const cleaned = sanitizeForIlike(parsed.nameQuery);
    if (cleaned) {
      url.searchParams.set("player_name", `ilike.*${cleaned}*`);
    }
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    SUPABASE_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (allowMockFallback) {
      return buildPlayersResponse({
        rows: getMockRows(),
        tab,
        parsed,
        cacheControl: "no-store",
        dataSource: "local-mock-fallback",
      });
    }

    return NextResponse.json(
      {
        error: "Supabase request failed",
        details: error instanceof Error ? error.message : "Unknown fetch error",
      },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorText = await response.text();
    if (allowMockFallback) {
      return buildPlayersResponse({
        rows: getMockRows(),
        tab,
        parsed,
        cacheControl: "no-store",
        dataSource: "local-mock-fallback",
      });
    }

    return NextResponse.json(
      { error: "Supabase query failed", details: errorText.slice(0, 500) },
      { status: 500 }
    );
  }

  const rows = (await response.json()) as PlayerRow[];
  const reviewedRows = rows.filter(hasReviewSignal);
  const hydratedRows = await hydrateLatestPlayerIdentity({
    rows: reviewedRows,
    supabaseUrl,
    supabaseKey,
  });
  const mockRows = getMockRows();
  const hasAnyReviewSignal = hydratedRows.length > 0;

  if (!hasAnyReviewSignal && mockRows.length > 0) {
    return buildPlayersResponse({
      rows: mockRows,
      tab,
      parsed,
      cacheControl: "no-store",
      dataSource: "local-mock-fallback",
    });
  }

  return buildPlayersResponse({
    rows: hydratedRows,
    tab,
    parsed,
    cacheControl: "s-maxage=300, stale-while-revalidate=3600",
    dataSource: "supabase",
  });
}
