import { NextRequest, NextResponse } from "next/server";
import { queryLocalMockPlayers, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { POSITION_GROUPS, parseTab } from "@/lib/position-groups";
import { parsePlayerSearch } from "@/lib/search";
import { PlayerRow, PlayerTab } from "@/types/player";

const MV_FIELDS = [
  "player_id",
  "mention_count",
  "avg_sentiment_score",
  "top_pros",
  "top_cons",
  "last_processed_at",
].join(",");
const PLAYER_FIELDS = [
  "id",
  "player_name",
  "base_ovr",
  "base_position",
  "program_promo",
  "updated_at",
].join(",");

const MAX_LIMIT = 60;
const SUPABASE_REQUEST_TIMEOUT_MS = 9000;
const MAX_IDS_PER_QUERY = 120;
const CANDIDATE_TAB_LIMIT = 2000;
const CANDIDATE_SEARCH_MIN_LIMIT = 180;

type PlayerIdentityRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
  updated_at: string;
};

type MvSummaryRow = {
  player_id: string;
  mention_count: number | null;
  avg_sentiment_score: number | null;
  top_pros: PlayerRow["top_pros"];
  top_cons: PlayerRow["top_cons"];
  last_processed_at: string | null;
};

type ApprovedUserReviewRow = {
  player_id: string;
  sentiment_score: number | string;
  submitted_at: string;
  pros: string[] | null;
  cons: string[] | null;
};

type ReviewFallbackAggregate = {
  count: number;
  scoreSum: number;
  latestSubmittedAt: string | null;
  pros: Map<string, number>;
  cons: Map<string, number>;
};

function sanitizeForIlike(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
}

function chunkArray<T>(values: T[], chunkSize: number) {
  if (chunkSize <= 0 || values.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
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

function normalizeInsightTerm(input: string) {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function toTopTerms(source: Map<string, number>) {
  return [...source.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));
}

function sortRowsForFeed(a: PlayerRow, b: PlayerRow) {
  const scoreA = a.avg_sentiment_score ?? -1;
  const scoreB = b.avg_sentiment_score ?? -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (a.mention_count !== b.mention_count) return b.mention_count - a.mention_count;
  if (a.base_ovr !== b.base_ovr) return b.base_ovr - a.base_ovr;
  return a.player_name.localeCompare(b.player_name);
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

async function fetchPlayerCandidates(args: {
  supabaseUrl: string;
  supabaseKey: string;
  tab: PlayerTab;
  parsed: ReturnType<typeof parsePlayerSearch>;
  limit: number;
}): Promise<PlayerIdentityRow[] | null> {
  const { supabaseUrl, supabaseKey, tab, parsed, limit } = args;
  const hasSearchQuery = parsed.raw.trim().length > 0;
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;
  const queryLimit =
    hasSearchQuery || isOvrOnlyQuery
      ? Math.max(limit * 8, CANDIDATE_SEARCH_MIN_LIMIT)
      : CANDIDATE_TAB_LIMIT;
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/players`);
  url.searchParams.set("select", PLAYER_FIELDS);
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("order", "updated_at.desc,base_ovr.desc,player_name.asc");
  url.searchParams.set("limit", String(queryLimit));

  if (!hasSearchQuery && !isOvrOnlyQuery) {
    url.searchParams.set("base_position", `in.(${POSITION_GROUPS[tab].join(",")})`);
  }

  if (parsed.requestedOvr !== null) {
    url.searchParams.set("base_ovr", `eq.${parsed.requestedOvr}`);
  }

  if (parsed.nameQuery) {
    const cleaned = sanitizeForIlike(parsed.nameQuery);
    if (cleaned) {
      url.searchParams.set(
        "or",
        `(player_name.ilike.*${cleaned}*,program_promo.ilike.*${cleaned}*,base_position.ilike.*${cleaned}*)`
      );
    }
  }

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
      next: { revalidate: 300 },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      return null;
    }
    return (await response.json()) as PlayerIdentityRow[];
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSkeletonRows(rows: PlayerIdentityRow[]): PlayerRow[] {
  return rows.map((row) => ({
    player_id: row.id,
    player_name: row.player_name,
    base_ovr: row.base_ovr,
    base_position: row.base_position,
    program_promo: row.program_promo,
    mention_count: 0,
    avg_sentiment_score: null,
    top_pros: [],
    top_cons: [],
    last_processed_at: null,
  }));
}

async function hydrateRowsFromSummaryView(args: {
  rows: PlayerRow[];
  supabaseUrl: string;
  supabaseKey: string;
}): Promise<PlayerRow[]> {
  const { rows, supabaseUrl, supabaseKey } = args;
  if (!rows.length) return rows;

  const out = new Map(rows.map((row) => [row.player_id, row]));
  const playerIds = Array.from(out.keys());
  const idChunks = chunkArray(playerIds, MAX_IDS_PER_QUERY);

  for (const chunk of idChunks) {
    const summaryUrl = new URL(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/mv_player_sentiment_summary`
    );
    summaryUrl.searchParams.set("select", MV_FIELDS);
    summaryUrl.searchParams.set("player_id", `in.(${chunk.join(",")})`);

    const summaryResponse = await fetch(summaryUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
    });

    if (!summaryResponse.ok) {
      continue;
    }

    const summaryRows = (await summaryResponse.json()) as MvSummaryRow[];
    for (const summary of summaryRows) {
      const current = out.get(summary.player_id);
      if (!current) continue;
      out.set(summary.player_id, {
        ...current,
        mention_count: Number(summary.mention_count ?? 0),
        avg_sentiment_score:
          summary.avg_sentiment_score === null
            ? null
            : Number(summary.avg_sentiment_score),
        top_pros: Array.isArray(summary.top_pros) ? summary.top_pros : [],
        top_cons: Array.isArray(summary.top_cons) ? summary.top_cons : [],
        last_processed_at: summary.last_processed_at,
      });
    }
  }

  return rows.map((row) => out.get(row.player_id) ?? row);
}

async function hydrateSignalsFromApprovedUserReviews(args: {
  rows: PlayerRow[];
  supabaseUrl: string;
  supabaseKey: string;
}): Promise<PlayerRow[]> {
  const { rows, supabaseUrl, supabaseKey } = args;
  if (!rows.length) return rows;

  const unresolvedIds = Array.from(
    new Set(rows.filter((row) => !hasReviewSignal(row)).map((row) => row.player_id))
  );
  if (!unresolvedIds.length) return rows;

  const aggregateByPlayer = new Map<string, ReviewFallbackAggregate>();
  const idChunks = chunkArray(unresolvedIds, MAX_IDS_PER_QUERY);

  for (const chunk of idChunks) {
    const reviewUrl = new URL(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/user_review_submissions`
    );
    reviewUrl.searchParams.set(
      "select",
      "player_id,sentiment_score,submitted_at,pros,cons"
    );
    reviewUrl.searchParams.set("player_id", `in.(${chunk.join(",")})`);
    reviewUrl.searchParams.set("status", "eq.approved");
    reviewUrl.searchParams.set("limit", "20000");

    const reviewResponse = await fetch(reviewUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
    });

    if (!reviewResponse.ok) continue;
    const reviewRows = (await reviewResponse.json()) as ApprovedUserReviewRow[];
    if (!reviewRows.length) continue;

    for (const review of reviewRows) {
      const score = Number(review.sentiment_score);
      if (!Number.isFinite(score)) continue;

      const current =
        aggregateByPlayer.get(review.player_id) ??
        ({
          count: 0,
          scoreSum: 0,
          latestSubmittedAt: null,
          pros: new Map<string, number>(),
          cons: new Map<string, number>(),
        } satisfies ReviewFallbackAggregate);

      current.count += 1;
      current.scoreSum += score;

      if (
        review.submitted_at &&
        (!current.latestSubmittedAt ||
          new Date(review.submitted_at).getTime() >
            new Date(current.latestSubmittedAt).getTime())
      ) {
        current.latestSubmittedAt = review.submitted_at;
      }

      for (const value of review.pros ?? []) {
        const key = normalizeInsightTerm(String(value));
        if (!key) continue;
        current.pros.set(key, (current.pros.get(key) ?? 0) + 1);
      }

      for (const value of review.cons ?? []) {
        const key = normalizeInsightTerm(String(value));
        if (!key) continue;
        current.cons.set(key, (current.cons.get(key) ?? 0) + 1);
      }

      aggregateByPlayer.set(review.player_id, current);
    }
  }

  return rows.map((row) => {
    // If MV already has a signal, trust it to avoid double counting.
    if (hasReviewSignal(row)) return row;

    const aggregate = aggregateByPlayer.get(row.player_id);
    if (!aggregate || aggregate.count <= 0) return row;

    return {
      ...row,
      mention_count: aggregate.count,
      avg_sentiment_score: Number((aggregate.scoreSum / aggregate.count).toFixed(2)),
      top_pros: toTopTerms(aggregate.pros),
      top_cons: toTopTerms(aggregate.cons),
      last_processed_at: aggregate.latestSubmittedAt,
    };
  });
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

  const candidateRows = await fetchPlayerCandidates({
    supabaseUrl,
    supabaseKey,
    tab,
    parsed,
    limit,
  });
  if (!candidateRows) {
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
      { error: "Supabase query failed", details: "Failed to load candidate players" },
      { status: 500 }
    );
  }
  if (!candidateRows.length) {
    return buildPlayersResponse({
      rows: [],
      tab,
      parsed,
      cacheControl: "s-maxage=300, stale-while-revalidate=3600",
      dataSource: "supabase",
    });
  }

  const skeletonRows = buildSkeletonRows(candidateRows);
  const summaryHydratedRows = await hydrateRowsFromSummaryView({
    rows: skeletonRows,
    supabaseUrl,
    supabaseKey,
  });
  const rowsWithReviewSignals = await hydrateSignalsFromApprovedUserReviews({
    rows: summaryHydratedRows,
    supabaseUrl,
    supabaseKey,
  });
  const reviewedRows = rowsWithReviewSignals
    .filter(hasReviewSignal)
    .sort(sortRowsForFeed)
    .slice(0, limit);
  const hasAnyReviewSignal = reviewedRows.length > 0;

  if (!hasAnyReviewSignal && allowMockFallback) {
    const mockRows = getMockRows();
    if (!mockRows.length) {
      return buildPlayersResponse({
        rows: [],
        tab,
        parsed,
        cacheControl: "no-store",
        dataSource: "supabase",
      });
    }
    return buildPlayersResponse({
      rows: mockRows,
      tab,
      parsed,
      cacheControl: "no-store",
      dataSource: "local-mock-fallback",
    });
  }

  return buildPlayersResponse({
    rows: reviewedRows,
    tab,
    parsed,
    cacheControl: "s-maxage=300, stale-while-revalidate=3600",
    dataSource: "supabase",
  });
}
