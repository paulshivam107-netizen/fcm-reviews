import { NextRequest, NextResponse } from "next/server";
import { shouldUseLocalMockData } from "@/lib/local-mock-data";
import { supabaseRpcRequest } from "@/lib/server/supabase-admin";

const DEFAULT_STALE_DAYS = 30;
const MIN_STALE_DAYS = 1;
const MAX_STALE_DAYS = 365;

function getCronSecret() {
  return process.env.CRON_SECRET?.trim() ?? "";
}

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function parseDays(value: unknown) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return DEFAULT_STALE_DAYS;
  return Math.max(MIN_STALE_DAYS, Math.min(MAX_STALE_DAYS, numeric));
}

export async function POST(request: NextRequest) {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 }
    );
  }

  const providedSecret =
    readBearerToken(request) || String(request.headers.get("x-cron-secret") ?? "");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as { days?: number };
    const days = parseDays(payload.days);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (shouldUseLocalMockData(supabaseUrl, supabaseKey)) {
      return NextResponse.json({
        success: true,
        archivedCount: 0,
        days,
        refreshed: false,
        mode: "local-mock",
      });
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

    return NextResponse.json({
      success: true,
      archivedCount: Number.isFinite(archivedCount) ? archivedCount : 0,
      days,
      refreshed: refreshResponse.ok,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
