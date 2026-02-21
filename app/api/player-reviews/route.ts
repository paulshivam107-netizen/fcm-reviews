import { NextRequest, NextResponse } from "next/server";
import {
  findLocalMockPlayerByIdentity,
  queryLocalMockReviewsByPlayer,
  queryLocalMockReviewsByIdentity,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { PlayerReviewFeedItem, PlayerReviewsApiResponse } from "@/types/review";

const MAX_LIMIT = 10;
const SUPABASE_REQUEST_TIMEOUT_MS = 9000;

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

type SupabasePlayerIdentityRow = {
  player_name: string;
  base_ovr: number;
  program_promo: string;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function toFiniteScore(value: number | string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function buildResponse(args: {
  playerId: string;
  items: PlayerReviewFeedItem[];
  cacheControl: string;
  dataSource: "supabase" | "local-mock" | "local-mock-fallback";
}) {
  const { playerId, items, cacheControl, dataSource } = args;
  const payload: PlayerReviewsApiResponse = {
    items,
    meta: {
      playerId,
      count: items.length,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": cacheControl,
      "X-Data-Source": dataSource,
    },
  });
}

function parseLimit(value: string | null) {
  const raw = Number.parseInt(value ?? "5", 10);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(MAX_LIMIT, raw));
}

function getFallbackRows(playerId: string, limit: number) {
  return queryLocalMockReviewsByPlayer({ playerId, limit });
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

export async function GET(request: NextRequest) {
  const playerId = String(
    request.nextUrl.searchParams.get("playerId") ?? ""
  ).trim();
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const allowMockFallback =
    process.env.NODE_ENV !== "production" &&
    String(process.env.USE_LOCAL_MOCK_FALLBACK ?? "false").toLowerCase() === "true";

  if (!isUuidLike(playerId)) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
    return buildResponse({
      playerId,
      items: getFallbackRows(playerId, limit),
      cacheControl: "no-store",
      dataSource: "local-mock",
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    if (allowMockFallback) {
      return buildResponse({
        playerId,
        items: getFallbackRows(playerId, limit),
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

  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const redditUrl = new URL(`${baseUrl}/rest/v1/player_sentiment_mentions`);
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
  redditUrl.searchParams.set("limit", String(limit));

  const userUrl = new URL(`${baseUrl}/rest/v1/user_review_submissions`);
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
  userUrl.searchParams.set("limit", String(limit));

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    SUPABASE_REQUEST_TIMEOUT_MS
  );

  try {
    const [redditResponse, userResponse] = await Promise.all([
      fetch(redditUrl, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        next: { revalidate: 180 },
        signal: timeoutController.signal,
      }),
      fetch(userUrl, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        next: { revalidate: 180 },
        signal: timeoutController.signal,
      }),
    ]);

    if (!redditResponse.ok || !userResponse.ok) {
      const redditError = redditResponse.ok
        ? ""
        : (await redditResponse.text()).slice(0, 300);
      const userError = userResponse.ok
        ? ""
        : (await userResponse.text()).slice(0, 300);

      if (allowMockFallback) {
        return buildResponse({
          playerId,
          items: getFallbackRows(playerId, limit),
          cacheControl: "no-store",
          dataSource: "local-mock-fallback",
        });
      }

      return NextResponse.json(
        { error: "Supabase query failed", details: `${redditError} ${userError}`.trim() },
        { status: 500 }
      );
    }

    const redditRows = (await redditResponse.json()) as RedditMentionRow[];
    const userRows = (await userResponse.json()) as UserSubmissionRow[];

    const mergedRows = [
      ...redditRows.map(buildRedditItem),
      ...userRows.map(buildUserItem),
    ]
      .sort(
        (a, b) =>
          new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      )
      .slice(0, limit);

    if (mergedRows.length === 0) {
      if (allowMockFallback) {
        const directMockRows = getFallbackRows(playerId, limit);
        if (directMockRows.length > 0) {
          return buildResponse({
            playerId,
            items: directMockRows,
            cacheControl: "no-store",
            dataSource: "local-mock-fallback",
          });
        }
      }

      const playersUrl = new URL(`${baseUrl}/rest/v1/players`);
      playersUrl.searchParams.set(
        "select",
        "player_name,base_ovr,program_promo"
      );
      playersUrl.searchParams.set("id", `eq.${playerId}`);
      playersUrl.searchParams.set("limit", "1");

      const playerIdentityResponse = await fetch(playersUrl, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        next: { revalidate: 180 },
        signal: timeoutController.signal,
      });

      if (playerIdentityResponse.ok) {
        const identityRows = (await playerIdentityResponse.json()) as SupabasePlayerIdentityRow[];
        const identityRow = identityRows[0];
        if (allowMockFallback && identityRow) {
          const localByIdentity = findLocalMockPlayerByIdentity({
            playerName: identityRow.player_name,
            baseOvr: identityRow.base_ovr,
            programPromo: identityRow.program_promo,
          });

          if (localByIdentity) {
            const identityMockRows = queryLocalMockReviewsByIdentity({
              playerName: identityRow.player_name,
              baseOvr: identityRow.base_ovr,
              programPromo: identityRow.program_promo,
              limit,
            });
            if (identityMockRows.length > 0) {
              return buildResponse({
                playerId,
                items: identityMockRows,
                cacheControl: "no-store",
                dataSource: "local-mock-fallback",
              });
            }
          }
        }
      }
    }

    return buildResponse({
      playerId,
      items: mergedRows,
      cacheControl: "s-maxage=180, stale-while-revalidate=900",
      dataSource: "supabase",
    });
  } catch (error) {
    if (allowMockFallback) {
      return buildResponse({
        playerId,
        items: getFallbackRows(playerId, limit),
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
