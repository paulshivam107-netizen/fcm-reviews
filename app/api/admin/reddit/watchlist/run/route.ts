import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/server/admin-session";
import {
  listRedditWatchlistRuns,
  runRedditWatchlistSync,
} from "@/src/admin/reddit/service";
import { RedditWatchlistRunHistoryResponse } from "@/types/admin-imports";

export async function GET(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "12", 10);
    const items = await listRedditWatchlistRuns(limit);
    const response: RedditWatchlistRunHistoryResponse = {
      items,
      meta: { count: items.length },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch watchlist runs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAdminSession(request);
  if (!auth.ok) return auth.response;

  try {
    const payload = (await request.json().catch(() => ({}))) as {
      limitPerEntry?: number;
    };

    const result = await runRedditWatchlistSync({
      limitPerEntry: payload.limitPerEntry,
      mode: "admin",
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
