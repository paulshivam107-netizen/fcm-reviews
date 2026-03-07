import { NextRequest, NextResponse } from "next/server";
import { LOCAL_MOCK_PLAYERS, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { PlayerRow } from "@/types/player";

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 6;
const SUPABASE_REQUEST_TIMEOUT_MS = 9000;

type LatestSummaryRow = {
  player_id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  mention_count: number | null;
  avg_sentiment_score: number | null;
  top_pros: PlayerRow["top_pros"] | null;
  top_cons: PlayerRow["top_cons"] | null;
  last_processed_at: string | null;
};

type LatestCommunityReviewsApiResponse = {
  items: PlayerRow[];
  meta: {
    count: number;
    limit: number;
  };
};

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, raw));
}

function hasReviewSignal(row: PlayerRow) {
  const hasCount = Number(row.mention_count ?? 0) > 0;
  const hasScore = row.avg_sentiment_score !== null;
  return hasCount || hasScore || Boolean(row.last_processed_at);
}

function sortByRecentActivity(a: PlayerRow, b: PlayerRow) {
  const dateA = a.last_processed_at ? new Date(a.last_processed_at).getTime() : 0;
  const dateB = b.last_processed_at ? new Date(b.last_processed_at).getTime() : 0;
  if (dateA !== dateB) return dateB - dateA;

  if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;

  const scoreA = a.avg_sentiment_score ?? -1;
  const scoreB = b.avg_sentiment_score ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;

  return a.player_name.localeCompare(b.player_name);
}

function buildResponse(args: {
  items: PlayerRow[];
  limit: number;
  cacheControl: string;
  dataSource: "supabase" | "local-mock" | "local-mock-fallback";
}) {
  const payload: LatestCommunityReviewsApiResponse = {
    items: args.items,
    meta: {
      count: args.items.length,
      limit: args.limit,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": args.cacheControl,
      "X-Data-Source": args.dataSource,
    },
  });
}

function toPlayerRow(row: LatestSummaryRow): PlayerRow {
  return {
    player_id: row.player_id,
    player_name: row.player_name,
    base_ovr: Number(row.base_ovr),
    base_position: row.base_position,
    program_promo: row.program_promo,
    mention_count: Number(row.mention_count ?? 0),
    avg_sentiment_score:
      row.avg_sentiment_score === null ? null : Number(row.avg_sentiment_score),
    top_pros: Array.isArray(row.top_pros) ? row.top_pros : [],
    top_cons: Array.isArray(row.top_cons) ? row.top_cons : [],
    last_processed_at: row.last_processed_at,
  };
}

function getLocalRows(limit: number) {
  return LOCAL_MOCK_PLAYERS.filter(hasReviewSignal)
    .sort(sortByRecentActivity)
    .slice(0, limit);
}

export async function GET(request: NextRequest) {
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const allowMockFallback =
    process.env.NODE_ENV !== "production" &&
    String(process.env.USE_LOCAL_MOCK_FALLBACK ?? "false").toLowerCase() === "true";

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
    return buildResponse({
      items: getLocalRows(limit),
      limit,
      cacheControl: "no-store",
      dataSource: "local-mock",
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    if (allowMockFallback) {
      return buildResponse({
        items: getLocalRows(limit),
        limit,
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

  const url = new URL(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/mv_player_sentiment_summary`
  );
  url.searchParams.set(
    "select",
    [
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
    ].join(",")
  );
  url.searchParams.set("order", "last_processed_at.desc.nullslast,mention_count.desc");
  url.searchParams.set("limit", String(Math.max(limit * 4, 32)));

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    SUPABASE_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 180 },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      if (allowMockFallback) {
        return buildResponse({
          items: getLocalRows(limit),
          limit,
          cacheControl: "no-store",
          dataSource: "local-mock-fallback",
        });
      }

      const details = (await response.text()).slice(0, 500);
      return NextResponse.json(
        { error: "Supabase query failed", details },
        { status: 500 }
      );
    }

    const summaryRows = (await response.json()) as LatestSummaryRow[];
    const items = summaryRows
      .map(toPlayerRow)
      .filter(hasReviewSignal)
      .sort(sortByRecentActivity)
      .slice(0, limit);

    return buildResponse({
      items,
      limit,
      cacheControl: "s-maxage=180, stale-while-revalidate=900",
      dataSource: "supabase",
    });
  } catch (error) {
    if (allowMockFallback) {
      return buildResponse({
        items: getLocalRows(limit),
        limit,
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
}
