import { NextRequest, NextResponse } from "next/server";
import { runRedditWatchlistSync } from "@/src/admin/reddit/service";

function getCronSecret() {
  return process.env.CRON_SECRET?.trim() ?? "";
}

function readBearerToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function parseLimit(value: unknown) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return undefined;
  return Math.max(1, Math.min(10, numeric));
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
    const payload = (await request.json().catch(() => ({}))) as { limitPerEntry?: number };
    const result = await runRedditWatchlistSync({
      limitPerEntry: parseLimit(payload.limitPerEntry),
      mode: "cron",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to run Reddit watchlist sync",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
