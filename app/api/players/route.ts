import { NextRequest, NextResponse } from "next/server";
import { queryLocalMockPlayers, shouldUseLocalMockData } from "@/lib/local-mock-data";
import { POSITION_GROUPS, parseTab } from "@/lib/position-groups";
import { parsePlayerSearch } from "@/lib/search";
import { PlayerRow } from "@/types/player";

const MV_FIELDS = [
  "player_id",
  "player_name",
  "base_ovr",
  "base_position",
  "program_promo",
  "mention_count",
  "avg_sentiment_score",
  "last_processed_at",
].join(",");

const MAX_LIMIT = 60;

function sanitizeForIlike(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
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
  const isOvrOnlyQuery =
    parsed.requestedOvr !== null && parsed.nameQuery.trim().length === 0;

  if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
    const rows = queryLocalMockPlayers({
      tab,
      parsed,
      limit,
      positionGroups: POSITION_GROUPS,
    });

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
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (!supabaseUrl || !supabaseKey) {
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
  url.searchParams.set("mention_count", "gt.0");
  if (!isOvrOnlyQuery) {
    url.searchParams.set(
      "base_position",
      `in.(${POSITION_GROUPS[tab].join(",")})`
    );
  }
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

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "Supabase query failed", details: errorText.slice(0, 500) },
      { status: 500 }
    );
  }

  const rows = (await response.json()) as PlayerRow[];

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
        "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
      },
    }
  );
}
