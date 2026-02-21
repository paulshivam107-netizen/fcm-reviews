import { NextRequest, NextResponse } from "next/server";
import {
  findLocalMockPlayerByIdentity,
  LOCAL_MOCK_PLAYERS,
  shouldUseLocalMockData,
} from "@/lib/local-mock-data";
import { PlayerApiResponse, PlayerRow } from "@/types/player";

const SUMMARY_FIELDS = [
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

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
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

function buildResponse(args: {
  item: PlayerRow;
  cacheControl: string;
  dataSource: "supabase" | "local-mock" | "local-mock-fallback";
}) {
  const payload: PlayerApiResponse = { item: args.item };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": args.cacheControl,
      "X-Data-Source": args.dataSource,
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ playerId: string }> }
) {
  const params = await context.params;
  const playerId = String(params.playerId ?? "").trim();
  if (!isUuidLike(playerId)) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const allowMockFallback =
    process.env.NODE_ENV !== "production" &&
    String(process.env.USE_LOCAL_MOCK_FALLBACK ?? "false").toLowerCase() === "true";
  const localItem = LOCAL_MOCK_PLAYERS.find((row) => row.player_id === playerId);

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
    if (!localItem) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    return buildResponse({
      item: localItem,
      cacheControl: "no-store",
      dataSource: "local-mock",
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    if (allowMockFallback && localItem) {
      return buildResponse({
        item: localItem,
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

  try {
    const summaryUrl = new URL(`${baseUrl}/rest/v1/mv_player_sentiment_summary`);
    summaryUrl.searchParams.set("select", SUMMARY_FIELDS);
    summaryUrl.searchParams.set("player_id", `eq.${playerId}`);
    summaryUrl.searchParams.set("limit", "1");

    const summaryResponse = await fetch(summaryUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
    });

    if (summaryResponse.ok) {
      const rows = (await summaryResponse.json()) as PlayerRow[];
      if (rows.length > 0) {
        const summaryRow = rows[0];
        if (!hasReviewSignal(summaryRow)) {
          if (allowMockFallback) {
            const localByIdentity = findLocalMockPlayerByIdentity({
              playerName: summaryRow.player_name,
              baseOvr: summaryRow.base_ovr,
              programPromo: summaryRow.program_promo,
            });
            if (localByIdentity) {
              return buildResponse({
                item: localByIdentity,
                cacheControl: "no-store",
                dataSource: "local-mock-fallback",
              });
            }
          }
          return NextResponse.json(
            { error: "Player has no approved reviews yet" },
            { status: 404 }
          );
        }

        return buildResponse({
          item: summaryRow,
          cacheControl: "s-maxage=300, stale-while-revalidate=3600",
          dataSource: "supabase",
        });
      }
    }

    const playersUrl = new URL(`${baseUrl}/rest/v1/players`);
    playersUrl.searchParams.set(
      "select",
      "id,player_name,base_ovr,base_position,program_promo"
    );
    playersUrl.searchParams.set("id", `eq.${playerId}`);
    playersUrl.searchParams.set("is_active", "eq.true");
    playersUrl.searchParams.set("limit", "1");

    const playerResponse = await fetch(playersUrl, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      next: { revalidate: 300 },
    });

    if (!playerResponse.ok) {
      const details = await playerResponse.text();
      if (allowMockFallback && localItem) {
        return buildResponse({
          item: localItem,
          cacheControl: "no-store",
          dataSource: "local-mock-fallback",
        });
      }
      return NextResponse.json(
        { error: "Supabase query failed", details: details.slice(0, 500) },
        { status: 500 }
      );
    }

    const playerRows = (await playerResponse.json()) as Array<{
      id: string;
      player_name: string;
      base_ovr: number;
      base_position: string;
      program_promo: string;
    }>;

    const baseRow = playerRows[0];
    if (!baseRow) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    const localByIdentity = findLocalMockPlayerByIdentity({
      playerName: baseRow.player_name,
      baseOvr: baseRow.base_ovr,
      programPromo: baseRow.program_promo,
    });
    if (allowMockFallback && localByIdentity) {
      return buildResponse({
        item: localByIdentity,
        cacheControl: "no-store",
        dataSource: "local-mock-fallback",
      });
    }

    return NextResponse.json(
      { error: "Player has no approved reviews yet" },
      { status: 404 }
    );
  } catch (error) {
    if (allowMockFallback && localItem) {
      return buildResponse({
        item: localItem,
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
  }
}
