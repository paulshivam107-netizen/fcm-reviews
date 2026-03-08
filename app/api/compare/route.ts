import { NextRequest, NextResponse } from "next/server";
import {
  findLocalMockPlayerByIdentity,
  LOCAL_MOCK_PLAYERS,
  queryLocalMockReviewsByIdentity,
  queryLocalMockReviewsByPlayer,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { CompareApiResponse, CompareCardPayload } from "@/types/compare";
import { PlayerRow } from "@/types/player";
import { PlayerReviewFeedItem } from "@/types/review";

const REVIEW_LIMIT = 4;

type BasePlayerRow = {
  id: string;
  player_name: string;
  base_ovr: number;
  base_position: string;
  program_promo: string;
};

type SummaryRow = {
  player_id: string;
  mention_count: number | null;
  avg_sentiment_score: number | null;
  top_pros: PlayerRow["top_pros"];
  top_cons: PlayerRow["top_cons"];
  last_processed_at: string | null;
};

type ApprovedUserReviewSummaryRow = {
  player_id: string;
  sentiment_score: number | string;
  submitted_at: string;
  pros: string[] | null;
  cons: string[] | null;
};

type RedditMentionRow = {
  id: string;
  source_platform: string;
  source_subreddit: string | null;
  source_url: string | null;
  sentiment_score: number | string;
  played_position: string | null;
  mentioned_rank_text: string | null;
  pros: string[] | null;
  cons: string[] | null;
  llm_summary: string | null;
  llm_processed_at: string;
};

type UserSubmissionRow = {
  id: string;
  source_platform: string;
  submitted_username: string | null;
  submitted_username_type: "reddit" | "game" | null;
  sentiment_score: number | string;
  played_position: string | null;
  mentioned_rank_text: string | null;
  pros: string[] | null;
  cons: string[] | null;
  note: string | null;
  submitted_at: string;
};

type SupabaseConfig = {
  baseUrl: string;
  key: string;
  allowMockFallback: boolean;
  useLocalMockOnly: boolean;
};

class RouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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

function toFiniteScore(value: number | string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function buildVerdict(card: CompareCardPayload["player"]) {
  const reviewCount = Math.max(0, Number(card.mention_count ?? 0));
  const pros = (card.top_pros ?? []).slice(0, 3).map((term) => term.text);
  const cons = (card.top_cons ?? []).slice(0, 2).map((term) => term.text);
  const sentiment = Number(card.avg_sentiment_score ?? NaN);
  const hasSentiment = Number.isFinite(sentiment);

  if (reviewCount === 0) {
    return "Not enough reviews yet for a full verdict.";
  }

  if (pros.length > 0 && cons.length > 0) {
    return `Community likes ${formatList(pros.slice(0, 2))}, but mentions ${formatList(
      cons.slice(0, 1)
    )}.`;
  }

  if (pros.length >= 2) {
    if (hasSentiment && sentiment >= 8.5) {
      return `Highly rated card with strong ${formatList(pros.slice(0, 3))}.`;
    }
    return `Early community feedback highlights ${formatList(pros.slice(0, 2))}.`;
  }

  if (pros.length === 1) {
    return `Early community feedback highlights ${pros[0]}.`;
  }

  if (cons.length > 0) {
    return `Community feedback is still limited, but ${formatList(
      cons.slice(0, 1)
    )} is mentioned as a weakness.`;
  }

  if (reviewCount <= 2) {
    return "Early community feedback is in, but more reviews will sharpen the verdict.";
  }

  return "Community feedback is building, but no clear consensus has formed yet.";
}

function buildRedditItem(row: RedditMentionRow): PlayerReviewFeedItem {
  const subreddit = row.source_subreddit?.trim();
  const sourceLabel = subreddit ? `r/${subreddit}` : "Reddit";

  return {
    id: row.id,
    sourcePlatform: "reddit",
    sourceLabel,
    sourceUrl: row.source_url ?? null,
    sentimentScore: toFiniteScore(row.sentiment_score),
    playedPosition: row.played_position,
    mentionedRankText: row.mentioned_rank_text,
    pros: Array.isArray(row.pros) ? row.pros : [],
    cons: Array.isArray(row.cons) ? row.cons : [],
    summary: row.llm_summary,
    submittedAt: row.llm_processed_at,
  };
}

function buildUserItem(row: UserSubmissionRow): PlayerReviewFeedItem {
  const sourceLabel =
    row.submitted_username_type === "reddit" && row.submitted_username
      ? `u/${row.submitted_username}`
      : row.submitted_username ?? "Web user";

  return {
    id: row.id,
    sourcePlatform: "user",
    sourceLabel,
    sourceUrl: null,
    sentimentScore: toFiniteScore(row.sentiment_score),
    playedPosition: row.played_position,
    mentionedRankText: row.mentioned_rank_text,
    pros: Array.isArray(row.pros) ? row.pros : [],
    cons: Array.isArray(row.cons) ? row.cons : [],
    summary: row.note,
    submittedAt: row.submitted_at,
  };
}

function getSupabaseConfig(): SupabaseConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const allowMockFallback =
    process.env.NODE_ENV !== "production" &&
    String(process.env.USE_LOCAL_MOCK_FALLBACK ?? "false").toLowerCase() === "true";
  const useLocalMockOnly = shouldUseLocalMockData(supabaseUrl, supabaseKey);

  if (useLocalMockOnly) {
    return {
      baseUrl: "",
      key: "",
      allowMockFallback,
      useLocalMockOnly: true,
    };
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new RouteError(
      500,
      "Missing SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return {
    baseUrl: supabaseUrl.replace(/\/+$/, ""),
    key: supabaseKey,
    allowMockFallback,
    useLocalMockOnly: false,
  };
}

function toSkeleton(base: BasePlayerRow): PlayerRow {
  return {
    player_id: base.id,
    player_name: base.player_name,
    base_ovr: base.base_ovr,
    base_position: base.base_position,
    program_promo: base.program_promo,
    mention_count: 0,
    avg_sentiment_score: null,
    top_pros: [],
    top_cons: [],
    last_processed_at: null,
  };
}

function applySummary(base: BasePlayerRow, summary: SummaryRow): PlayerRow {
  return {
    player_id: base.id,
    player_name: base.player_name,
    base_ovr: base.base_ovr,
    base_position: base.base_position,
    program_promo: base.program_promo,
    mention_count: Number(summary.mention_count ?? 0),
    avg_sentiment_score:
      summary.avg_sentiment_score === null ? null : Number(summary.avg_sentiment_score),
    top_pros: Array.isArray(summary.top_pros) ? summary.top_pros : [],
    top_cons: Array.isArray(summary.top_cons) ? summary.top_cons : [],
    last_processed_at: summary.last_processed_at,
  };
}

async function fetchJson<T>(url: URL, key: string) {
  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new RouteError(
      response.status >= 400 && response.status < 500 ? response.status : 500,
      details || `Supabase request failed (${response.status})`
    );
  }

  return (await response.json()) as T;
}

async function fetchPlayerSummary(playerId: string, config: SupabaseConfig): Promise<PlayerRow> {
  const localItem = LOCAL_MOCK_PLAYERS.find((row) => row.player_id === playerId);

  if (config.useLocalMockOnly) {
    if (!localItem) {
      throw new RouteError(404, "Player not found");
    }
    return localItem;
  }

  try {
    const playersUrl = new URL(`${config.baseUrl}/rest/v1/players`);
    playersUrl.searchParams.set(
      "select",
      "id,player_name,base_ovr,base_position,program_promo"
    );
    playersUrl.searchParams.set("id", `eq.${playerId}`);
    playersUrl.searchParams.set("is_active", "eq.true");
    playersUrl.searchParams.set("limit", "1");

    const baseRows = await fetchJson<BasePlayerRow[]>(playersUrl, config.key);
    const baseRow = baseRows[0];
    if (!baseRow) {
      throw new RouteError(404, "Player not found");
    }

    const summaryUrl = new URL(`${config.baseUrl}/rest/v1/mv_player_sentiment_summary`);
    summaryUrl.searchParams.set(
      "select",
      "player_id,mention_count,avg_sentiment_score,top_pros,top_cons,last_processed_at"
    );
    summaryUrl.searchParams.set("player_id", `eq.${playerId}`);
    summaryUrl.searchParams.set("limit", "1");

    const summaryRows = await fetchJson<SummaryRow[]>(summaryUrl, config.key).catch(() => []);
    const summary = summaryRows[0];
    if (summary) {
      const fromSummary = applySummary(baseRow, summary);
      if (hasReviewSignal(fromSummary)) {
        return fromSummary;
      }
    }

    const reviewsUrl = new URL(`${config.baseUrl}/rest/v1/user_review_submissions`);
    reviewsUrl.searchParams.set(
      "select",
      "player_id,sentiment_score,submitted_at,pros,cons"
    );
    reviewsUrl.searchParams.set("player_id", `eq.${playerId}`);
    reviewsUrl.searchParams.set("status", "eq.approved");
    reviewsUrl.searchParams.set("order", "submitted_at.desc");
    reviewsUrl.searchParams.set("limit", "20000");

    const reviewRows = await fetchJson<ApprovedUserReviewSummaryRow[]>(reviewsUrl, config.key).catch(
      () => []
    );

    if (reviewRows.length > 0) {
      let scoreSum = 0;
      let count = 0;
      const pros = new Map<string, number>();
      const cons = new Map<string, number>();
      let latest: string | null = null;

      for (const review of reviewRows) {
        const score = Number(review.sentiment_score);
        if (!Number.isFinite(score)) continue;

        count += 1;
        scoreSum += score;

        if (
          review.submitted_at &&
          (!latest || new Date(review.submitted_at).getTime() > new Date(latest).getTime())
        ) {
          latest = review.submitted_at;
        }

        for (const term of review.pros ?? []) {
          const key = normalizeInsightTerm(String(term));
          if (!key) continue;
          pros.set(key, (pros.get(key) ?? 0) + 1);
        }

        for (const term of review.cons ?? []) {
          const key = normalizeInsightTerm(String(term));
          if (!key) continue;
          cons.set(key, (cons.get(key) ?? 0) + 1);
        }
      }

      if (count > 0) {
        return {
          ...toSkeleton(baseRow),
          mention_count: count,
          avg_sentiment_score: Number((scoreSum / count).toFixed(2)),
          top_pros: toTopTerms(pros),
          top_cons: toTopTerms(cons),
          last_processed_at: latest,
        };
      }
    }

    if (config.allowMockFallback) {
      const localByIdentity = findLocalMockPlayerByIdentity({
        playerName: baseRow.player_name,
        baseOvr: baseRow.base_ovr,
        programPromo: baseRow.program_promo,
      });

      if (localByIdentity) return localByIdentity;
    }

    throw new RouteError(404, "Player has no approved reviews yet");
  } catch (error) {
    if (config.allowMockFallback && localItem) {
      return localItem;
    }

    if (error instanceof RouteError) throw error;
    throw new RouteError(
      500,
      error instanceof Error ? error.message : "Failed to fetch player summary"
    );
  }
}

async function fetchPlayerReviews(
  playerId: string,
  config: SupabaseConfig
): Promise<PlayerReviewFeedItem[]> {
  if (config.useLocalMockOnly) {
    return queryLocalMockReviewsByPlayer({ playerId, limit: REVIEW_LIMIT });
  }

  const localItem = LOCAL_MOCK_PLAYERS.find((row) => row.player_id === playerId);

  try {
    const redditUrl = new URL(`${config.baseUrl}/rest/v1/player_sentiment_mentions`);
    redditUrl.searchParams.set(
      "select",
      [
        "id",
        "source_platform",
        "source_subreddit",
        "source_url",
        "sentiment_score",
        "played_position",
        "mentioned_rank_text",
        "pros",
        "cons",
        "llm_summary",
        "llm_processed_at",
      ].join(",")
    );
    redditUrl.searchParams.set("player_id", `eq.${playerId}`);
    redditUrl.searchParams.set("order", "llm_processed_at.desc");
    redditUrl.searchParams.set("limit", String(REVIEW_LIMIT));

    const userUrl = new URL(`${config.baseUrl}/rest/v1/user_review_submissions`);
    userUrl.searchParams.set(
      "select",
      [
        "id",
        "source_platform",
        "submitted_username",
        "submitted_username_type",
        "sentiment_score",
        "played_position",
        "mentioned_rank_text",
        "pros",
        "cons",
        "note",
        "submitted_at",
      ].join(",")
    );
    userUrl.searchParams.set("player_id", `eq.${playerId}`);
    userUrl.searchParams.set("status", "eq.approved");
    userUrl.searchParams.set("order", "submitted_at.desc");
    userUrl.searchParams.set("limit", String(REVIEW_LIMIT));

    const [redditRows, userRows] = await Promise.all([
      fetchJson<RedditMentionRow[]>(redditUrl, config.key).catch(() => []),
      fetchJson<UserSubmissionRow[]>(userUrl, config.key).catch(() => []),
    ]);

    const mergedRows = [
      ...redditRows.map(buildRedditItem),
      ...userRows.map(buildUserItem),
    ]
      .sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      )
      .slice(0, REVIEW_LIMIT);

    if (mergedRows.length > 0) {
      return mergedRows;
    }

    if (config.allowMockFallback && localItem) {
      const identityRows = queryLocalMockReviewsByIdentity({
        playerName: localItem.player_name,
        baseOvr: localItem.base_ovr,
        programPromo: localItem.program_promo,
        limit: REVIEW_LIMIT,
      });
      if (identityRows.length > 0) return identityRows;
    }

    return [];
  } catch (error) {
    if (config.allowMockFallback) {
      return queryLocalMockReviewsByPlayer({ playerId, limit: REVIEW_LIMIT });
    }

    if (error instanceof RouteError) throw error;
    throw new RouteError(
      500,
      error instanceof Error ? error.message : "Failed to fetch player reviews"
    );
  }
}

async function fetchCardBundle(playerId: string) {
  const config = getSupabaseConfig();
  const [player, reviews] = await Promise.all([
    fetchPlayerSummary(playerId, config),
    fetchPlayerReviews(playerId, config),
  ]);

  const reviewCount = Math.max(0, Number(player.mention_count ?? 0));

  const payload: CompareCardPayload = {
    player,
    reviews,
    verdict: buildVerdict(player),
    reviewCount,
    isEarlySignal: reviewCount > 0 && reviewCount < 3,
  };

  return payload;
}

export async function GET(request: NextRequest) {
  const leftId = String(request.nextUrl.searchParams.get("left") ?? "").trim();
  const rightId = String(request.nextUrl.searchParams.get("right") ?? "").trim();

  if (!isUuidLike(leftId)) {
    return NextResponse.json({ error: "Invalid left player id" }, { status: 400 });
  }

  if (rightId && !isUuidLike(rightId)) {
    return NextResponse.json({ error: "Invalid right player id" }, { status: 400 });
  }

  try {
    const [left, right] = await Promise.all([
      fetchCardBundle(leftId),
      rightId ? fetchCardBundle(rightId) : Promise.resolve(null),
    ]);

    const payload: CompareApiResponse = {
      left,
      right,
      meta: {
        leftId,
        rightId: rightId || null,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Failed to build comparison";

    return NextResponse.json({ error: message }, { status });
  }
}
